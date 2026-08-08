/// Operations floor, ported from apps/web/src/app/operations/page.tsx.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../live.dart';
import '../models.dart';
import '../session.dart';
import '../theme.dart';
import '../widgets/primitives.dart';
import '../widgets/agent_mesh.dart';

const Map<String, Tone> _runTone = {
  'running': Tone.hazard,
  'paused': Tone.neutral,
  'succeeded': Tone.clear,
  'failed': Tone.refused,
  'cancelled': Tone.neutral,
};

class FloorScreen extends StatelessWidget {
  final void Function(int index)? onNavigate;
  const FloorScreen({super.key, this.onNavigate});

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final tenantId = session.tenantId;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Eyebrow('Floor'),
        const SizedBox(height: 8),
        const Text('Agent operations',
            style: TextStyle(fontSize: 26, color: AppColors.chalk, fontWeight: FontWeight.w700)),
        const SizedBox(height: 20),
        if (tenantId == null)
          const EmptyState('Connecting to your workspace.')
        else
          StreamBuilder<List<ApprovalRequest>>(
            stream: watchPendingApprovals(tenantId),
            builder: (context, approvalsSnap) {
              final approvals = approvalsSnap.data ?? const <ApprovalRequest>[];
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (approvals.isNotEmpty) ...[
                    HazardBar(
                      label:
                          '${approvals.length} decision${approvals.length == 1 ? '' : 's'} waiting on you',
                    ),
                    const SizedBox(height: 12),
                    for (final approval in approvals.take(2)) ...[
                      DocumentCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Eyebrow(approval.counterparty, onPaper: true),
                                      const SizedBox(height: 4),
                                      Text(approval.description,
                                          style: const TextStyle(color: AppColors.ink, fontSize: 13)),
                                    ],
                                  ),
                                ),
                                Figure(formatMoney(approval.amountUnits, approval.asset),
                                    color: AppColors.ink, fontSize: 16),
                              ],
                            ),
                            const SizedBox(height: 8),
                            Text(approval.reason,
                                style: const TextStyle(color: AppColors.inkSoft, fontSize: 11)),
                            const SizedBox(height: 10),
                            TextButton(
                              onPressed: () => onNavigate?.call(2),
                              style: TextButton.styleFrom(padding: EdgeInsets.zero),
                              child: const Text('Review this payment',
                                  style: TextStyle(color: AppColors.ink, decoration: TextDecoration.underline)),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 12),
                    ],
                    if (approvals.length > 2)
                      TextButton(
                        onPressed: () => onNavigate?.call(2),
                        style: TextButton.styleFrom(padding: EdgeInsets.zero),
                        child: Text('${approvals.length - 2} more waiting',
                            style: const TextStyle(
                                color: AppColors.chalkSoft, decoration: TextDecoration.underline)),
                      ),
                    const SizedBox(height: 20),
                  ],
                  StreamBuilder<List<RunSummary>>(
                    stream: watchRuns(tenantId),
                    builder: (context, runsSnap) {
                      final runs = runsSnap.data ?? const <RunSummary>[];
                      final active =
                          runs.where((r) => r.status == 'running' || r.status == 'paused').length;
                      final runningRuns = runs.where((r) => r.status == 'running');
                      final activeRunId = runningRuns.isEmpty ? null : runningRuns.first.id;

                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          FloorPanel(
                            title: 'Runs',
                            child: !runsSnap.hasData
                                ? const EmptyState('Connecting to your workspace.')
                                : runsSnap.hasError
                                    ? EmptyState('Could not load runs: ${runsSnap.error}')
                                    : runs.isEmpty
                                        ? const EmptyState(
                                            'No runs yet. When you give the major agent a goal, its '
                                            'work appears here step by step.',
                                          )
                                        : Column(
                                            children: [
                                              for (final run in runs) _RunRow(run: run),
                                            ],
                                          ),
                          ),
                          const SizedBox(height: 16),
                          // The org chart of who is acting on the operator's
                          // behalf — mobile's version of
                          // apps/web/src/components/agent-rail.tsx, which had
                          // no phone equivalent until now.
                          FloorPanel(
                            title: 'Agents',
                            child: activeRunId == null
                                ? _AgentRoster(activity: const {})
                                : StreamBuilder<List<RunStep>>(
                                    stream: watchRunSteps(activeRunId),
                                    builder: (context, stepsSnap) {
                                      final steps = stepsSnap.data ?? const <RunStep>[];
                                      return _AgentRoster(activity: agentActivityFrom(steps));
                                    },
                                  ),
                          ),
                          const SizedBox(height: 16),
                          // Same mesh graph as apps/web/src/components/agent-mesh.tsx —
                          // every agent wired to every other agent, lit up when actually
                          // talking, instead of the plain negotiation transcript.
                          FloorPanel(
                            title: 'Agent network',
                            child: Padding(
                              padding: const EdgeInsets.all(12),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  activeRunId == null
                                      ? const AgentMesh(activity: {})
                                      : StreamBuilder<List<RunStep>>(
                                          stream: watchRunSteps(activeRunId),
                                          builder: (context, stepsSnap) {
                                            final steps = stepsSnap.data ?? const <RunStep>[];
                                            return AgentMesh(
                                              activity: agentActivityFrom(steps),
                                              callerListener: callerListenerFrom(steps),
                                            );
                                          },
                                        ),
                                  const SizedBox(height: 8),
                                  Text(
                                    'Settlement also runs one real, separate wallet check via '
                                    'the Zerion API on every payment.',
                                    style: TextStyle(fontSize: 11, color: AppColors.chalkFaint),
                                  ),
                                ],
                              ),
                            ),
                          ),
                          const SizedBox(height: 16),
                          FloorPanel(
                            title: 'Right now',
                            child: Row(
                              children: [
                                Expanded(child: _Stat(label: 'Active runs', value: '$active')),
                                Container(width: 1, height: 64, color: AppColors.seam),
                                Expanded(
                                    child: _Stat(label: 'Waiting on you', value: '${approvals.length}')),
                              ],
                            ),
                          ),
                          const SizedBox(height: 16),
                          // Cargo lives on the Floor rather than in its own
                          // tab: the phone's bottom bar is already at the
                          // five destinations Material recommends, and "what
                          // is moving" is part of the overview this screen is.
                          FloorPanel(
                            title: 'Cargo in transit',
                            child: StreamBuilder<List<Shipment>>(
                              stream: watchShipments(tenantId),
                              builder: (context, shipSnap) {
                                if (shipSnap.hasError) {
                                  return EmptyState('Could not load shipments: ${shipSnap.error}');
                                }
                                if (!shipSnap.hasData) {
                                  return const EmptyState('Connecting to your workspace.');
                                }
                                final shipments = shipSnap.data!;
                                if (shipments.isEmpty) {
                                  return const EmptyState(
                                    'Nothing is moving yet. Once the logistics agent books '
                                    'capacity, the cargo appears here.',
                                  );
                                }
                                return Column(
                                  children: [
                                    for (final shipment in shipments) _ShipmentRow(shipment: shipment),
                                  ],
                                );
                              },
                            ),
                          ),
                          const SizedBox(height: 16),
                          const FloorPanel(
                            title: 'What the agents may do',
                            child: Padding(
                              padding: EdgeInsets.all(16),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    'Settlement is the only agent that can move funds, and only up to '
                                    'the cap on each step.',
                                    style: TextStyle(color: AppColors.chalkSoft, fontSize: 13),
                                  ),
                                  SizedBox(height: 10),
                                  Text(
                                    'Compliance can stop any step outright. Nothing overrides it — not '
                                    'the major agent, not an approval.',
                                    style: TextStyle(color: AppColors.chalkSoft, fontSize: 13),
                                  ),
                                  SizedBox(height: 10),
                                  Text(
                                    'Payments above your threshold stop and wait for a person. That is '
                                    'the hazard marking above.',
                                    style: TextStyle(color: AppColors.chalkSoft, fontSize: 13),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      );
                    },
                  ),
                ],
              );
            },
          ),
      ],
    );
  }
}

const Map<String, Color> _activityDot = {
  'working': AppColors.hazard,
  'waiting': AppColors.chalkSoft,
  'blocked': AppColors.refused,
};

/// The six specialist agents and their real permission — same roster as
/// apps/web/src/components/agent-rail.tsx, so a reviewer can see least
/// privilege in the interface on either platform.
class _AgentRoster extends StatelessWidget {
  final Map<String, AgentActivity> activity;
  const _AgentRoster({required this.activity});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (final agent in agentRoster)
          Builder(builder: (context) {
            final live = activity[agent['role']];
            final dotColor = live != null ? (_activityDot[live.activity] ?? AppColors.chalkFaint) : AppColors.chalkFaint;
            return Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: AppColors.seam))),
              child: Row(
                children: [
                  Container(
                    width: 6,
                    height: 6,
                    margin: const EdgeInsets.only(right: 10),
                    decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle),
                  ),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(agent['name']!, style: const TextStyle(color: AppColors.chalk, fontSize: 13)),
                        Text(
                          live?.detail ?? agent['authority']!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: AppColors.chalkFaint, fontSize: 11),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            );
          }),
      ],
    );
  }
}

class _RunRow extends StatelessWidget {
  final RunSummary run;
  const _RunRow({required this.run});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: AppColors.seam))),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(run.goal, maxLines: 1, overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: AppColors.chalk, fontSize: 13)),
                Figure(run.id, color: AppColors.chalkFaint, fontSize: 11),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Figure(
            run.settledUnits != null ? formatMoney(run.settledUnits!, 'USDC') : '—',
            color: AppColors.chalkSoft,
            fontSize: 12,
          ),
          const SizedBox(width: 12),
          Marker(run.status, tone: _runTone[run.status] ?? Tone.neutral),
        ],
      ),
    );
  }
}

class _ShipmentRow extends StatelessWidget {
  final Shipment shipment;
  const _ShipmentRow({required this.shipment});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: AppColors.seam))),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text('${shipment.originName} → ${shipment.destinationName}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: AppColors.chalk, fontSize: 13)),
              ),
              const SizedBox(width: 8),
              Marker(shipment.status),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            '${shipmentModeLabel[shipment.mode] ?? shipment.mode} · arrives in ${shipment.etaDays} days',
            style: const TextStyle(color: AppColors.chalkFaint, fontSize: 11),
          ),
          const SizedBox(height: 8),
          // Progress as a plain bar: the percentage is the whole story.
          Semantics(
            label: '${(shipment.progress * 100).round()} per cent of the way',
            child: ClipRRect(
              borderRadius: BorderRadius.circular(1),
              child: LinearProgressIndicator(
                value: shipment.progress.clamp(0.0, 1.0),
                minHeight: 4,
                backgroundColor: AppColors.seam,
                valueColor: const AlwaysStoppedAnimation<Color>(AppColors.hazard),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  final String label;
  final String value;
  const _Stat({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Eyebrow(label),
          const SizedBox(height: 6),
          Text(value, style: tabularStyle(fontSize: 28)),
        ],
      ),
    );
  }
}
