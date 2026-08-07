/// Operations floor, ported from apps/web/src/app/operations/page.tsx.
library;

import 'package:flutter/material.dart';
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
                              onPressed: () => onNavigate?.call(1),
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
                        onPressed: () => onNavigate?.call(1),
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
