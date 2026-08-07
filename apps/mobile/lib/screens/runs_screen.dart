/// The audit trail, ported from apps/web/src/app/operations/runs/page.tsx.
///
/// The sign-in screen promises a full, replayable trace and
/// firebase/firestore.rules backs that with `allow write: if false` on every
/// trace document. This is where that promise is kept on a phone: pick a run,
/// read exactly what its agents did and where a guard stopped them.
library;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../live.dart';
import '../models.dart';
import '../session.dart';
import '../theme.dart';
import '../widgets/primitives.dart';

const Map<String, Tone> _runTone = {
  'running': Tone.hazard,
  'paused': Tone.neutral,
  'succeeded': Tone.clear,
  'failed': Tone.refused,
  'cancelled': Tone.neutral,
};

const Map<String, Tone> _stepTone = {
  'pending': Tone.neutral,
  'ready': Tone.neutral,
  'running': Tone.hazard,
  'awaiting_approval': Tone.hazard,
  'succeeded': Tone.clear,
  'failed': Tone.refused,
  'skipped': Tone.neutral,
  'cancelled': Tone.neutral,
};

/// Trace events where a person, or a guard, stopped something. Everything
/// else stays quiet so the trail reads at a glance rather than as a uniform
/// wall of entries.
const Map<String, Tone> _traceTone = {
  'step_succeeded': Tone.clear,
  'step_failed': Tone.refused,
  'step_awaiting_approval': Tone.hazard,
  'step_approved': Tone.clear,
  'step_rejected': Tone.refused,
  'commit_refused': Tone.refused,
  'run_paused': Tone.hazard,
  'run_cancelled': Tone.refused,
  'run_finished': Tone.clear,
};

class RunsScreen extends StatelessWidget {
  const RunsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final tenantId = session.tenantId;

    if (tenantId == null) {
      return const _Padded(child: EmptyState('Connecting to your workspace.'));
    }

    return StreamBuilder<List<RunSummary>>(
      stream: watchRuns(tenantId, max: 50),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return _Padded(child: EmptyState('Could not load runs: ${snapshot.error}'));
        }
        if (!snapshot.hasData) {
          return const _Padded(child: EmptyState('Connecting to your workspace.'));
        }
        final runs = snapshot.data!;
        if (runs.isEmpty) {
          return const _Padded(
            child: EmptyState(
              'No runs yet. When you give the major agent a goal, its work appears here '
              'step by step.',
            ),
          );
        }

        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const Eyebrow('Runs'),
            const SizedBox(height: 8),
            const Text('What the agents actually did',
                style: TextStyle(fontSize: 24, color: AppColors.chalk, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            const Text(
              'Every step, in order, and every action a guard refused. Written by the '
              'orchestrator and read-only to everyone — including us.',
              style: TextStyle(color: AppColors.chalkSoft, fontSize: 13),
            ),
            const SizedBox(height: 20),
            for (final run in runs) ...[
              _RunCard(run: run),
              const SizedBox(height: 10),
            ],
          ],
        );
      },
    );
  }
}

class _Padded extends StatelessWidget {
  final Widget child;
  const _Padded({required this.child});

  @override
  Widget build(BuildContext context) =>
      ListView(padding: const EdgeInsets.all(16), children: [child]);
}

/// A run, expandable into its steps and its trail.
///
/// Collapsed by default and streaming its subcollections only once opened —
/// on a phone, subscribing to every run's trace at once would be a lot of
/// listeners for data nobody is looking at.
class _RunCard extends StatefulWidget {
  final RunSummary run;
  const _RunCard({required this.run});

  @override
  State<_RunCard> createState() => _RunCardState();
}

class _RunCardState extends State<_RunCard> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final run = widget.run;
    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.seam),
        borderRadius: BorderRadius.circular(2),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            onTap: () => setState(() => _open = !_open),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(run.goal,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: AppColors.chalk, fontSize: 14)),
                        const SizedBox(height: 2),
                        Figure(run.id, color: AppColors.chalkFaint, fontSize: 11),
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  Marker(run.status, tone: _runTone[run.status] ?? Tone.neutral),
                  Icon(_open ? Icons.expand_less : Icons.expand_more,
                      size: 20, color: AppColors.chalkFaint),
                ],
              ),
            ),
          ),
          if (_open) _RunDetail(runId: run.id),
        ],
      ),
    );
  }
}

class _RunDetail extends StatelessWidget {
  final String runId;
  const _RunDetail({required this.runId});

  @override
  Widget build(BuildContext context) {
    final dateFormat = DateFormat.Hms();

    return Container(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.seam)),
      ),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Eyebrow('Steps'),
          const SizedBox(height: 8),
          StreamBuilder<List<RunStep>>(
            stream: watchRunSteps(runId),
            builder: (context, snap) {
              if (snap.hasError) {
                return Text('Could not load steps: ${snap.error}',
                    style: const TextStyle(color: AppColors.chalkFaint, fontSize: 12));
              }
              if (!snap.hasData) {
                return const Text('Loading steps.',
                    style: TextStyle(color: AppColors.chalkFaint, fontSize: 12));
              }
              final steps = snap.data!;
              if (steps.isEmpty) {
                return const Text('This run recorded no steps.',
                    style: TextStyle(color: AppColors.chalkFaint, fontSize: 12));
              }
              return Column(
                children: [
                  for (final step in steps)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Figure(step.stepId, fontSize: 12),
                                Text(
                                  step.error ?? step.skipReason ?? '${step.role} · ${step.kind}',
                                  style: const TextStyle(
                                      color: AppColors.chalkFaint, fontSize: 11),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 8),
                          Marker(step.status, tone: _stepTone[step.status] ?? Tone.neutral),
                        ],
                      ),
                    ),
                ],
              );
            },
          ),
          const SizedBox(height: 16),
          const Eyebrow('Trace'),
          const SizedBox(height: 8),
          StreamBuilder<List<TraceEvent>>(
            stream: watchRunTrace(runId),
            builder: (context, snap) {
              if (snap.hasError) {
                return Text('Could not load the trace: ${snap.error}',
                    style: const TextStyle(color: AppColors.chalkFaint, fontSize: 12));
              }
              if (!snap.hasData) {
                return const Text('Loading the trail.',
                    style: TextStyle(color: AppColors.chalkFaint, fontSize: 12));
              }
              final events = snap.data!;
              if (events.isEmpty) {
                return const Text('No trace events recorded for this run.',
                    style: TextStyle(color: AppColors.chalkFaint, fontSize: 12));
              }
              return Column(
                children: [
                  for (final event in events)
                    Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.only(left: 10),
                      decoration: const BoxDecoration(
                        border: Border(left: BorderSide(color: AppColors.seam, width: 2)),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Figure(event.seq.toString().padLeft(3, '0'),
                                  color: AppColors.chalkFaint, fontSize: 11),
                              const SizedBox(width: 8),
                              Marker(event.type, tone: _traceTone[event.type] ?? Tone.neutral),
                              const SizedBox(width: 8),
                              Text(
                                dateFormat.format(
                                    DateTime.fromMillisecondsSinceEpoch(event.at)),
                                style: tabularStyle(color: AppColors.chalkFaint, fontSize: 10),
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(event.summary,
                              style: const TextStyle(
                                  color: AppColors.chalkSoft, fontSize: 12)),
                        ],
                      ),
                    ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}
