/// The approval inbox, ported from apps/web/src/app/operations/approvals/page.tsx.
///
/// The one screen where a person acts on the system rather than watching it —
/// the only collection a client may write to at all.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../live.dart';
import '../models.dart';
import '../session.dart';
import '../theme.dart';
import '../widgets/primitives.dart';

class ApprovalsScreen extends StatefulWidget {
  const ApprovalsScreen({super.key});

  @override
  State<ApprovalsScreen> createState() => _ApprovalsScreenState();
}

class _ApprovalsScreenState extends State<ApprovalsScreen> {
  String? _busyId;
  String? _error;

  Future<void> _decide(ApprovalRequest approval, bool approved) async {
    final session = context.read<Session>();
    final uid = session.user?.uid;
    if (uid == null) return;
    setState(() {
      _busyId = approval.id;
      _error = null;
    });
    try {
      await decideApproval(approvalId: approval.id, approved: approved, decidedByUid: uid);
    } catch (cause) {
      setState(() => _error =
          'That decision did not save: $cause. The request may have already been decided elsewhere.');
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final tenantId = session.tenantId;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Eyebrow('Approvals'),
        const SizedBox(height: 8),
        const Text('Decisions waiting on you',
            style: TextStyle(fontSize: 26, color: AppColors.chalk, fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        const Text(
          'Agents pause here when a payment is above your threshold. Nothing settles until you decide.',
          style: TextStyle(color: AppColors.chalkSoft, fontSize: 13),
        ),
        const SizedBox(height: 20),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: Text(_error!, style: const TextStyle(color: AppColors.refused, fontSize: 13)),
          ),
        if (tenantId == null)
          const EmptyState('Connecting to your workspace.')
        else
          StreamBuilder<List<ApprovalRequest>>(
            stream: watchPendingApprovals(tenantId),
            builder: (context, snapshot) {
              if (snapshot.hasError) {
                return EmptyState('Could not load approvals: ${snapshot.error}');
              }
              if (!snapshot.hasData) {
                return const EmptyState('Connecting to your workspace.');
              }
              final approvals = snapshot.data!;
              if (approvals.isEmpty) {
                return const EmptyState(
                  'Nothing is waiting. When an agent proposes a payment above your threshold, '
                  'it stops here and asks.',
                );
              }
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  HazardBar(
                    label:
                        '${approvals.length} payment${approvals.length == 1 ? '' : 's'} cannot proceed without a person',
                  ),
                  const SizedBox(height: 16),
                  for (final approval in approvals) ...[
                    _ApprovalCard(
                      approval: approval,
                      busy: _busyId == approval.id,
                      onApprove: () => _decide(approval, true),
                      onReject: () => _decide(approval, false),
                    ),
                    const SizedBox(height: 12),
                  ],
                ],
              );
            },
          ),
      ],
    );
  }
}

class _ApprovalCard extends StatelessWidget {
  final ApprovalRequest approval;
  final bool busy;
  final VoidCallback onApprove;
  final VoidCallback onReject;

  const _ApprovalCard({
    required this.approval,
    required this.busy,
    required this.onApprove,
    required this.onReject,
  });

  @override
  Widget build(BuildContext context) {
    return DocumentCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Eyebrow('Pay ${approval.counterparty}', onPaper: true),
                    const SizedBox(height: 6),
                    Text(approval.description, style: const TextStyle(color: AppColors.ink)),
                  ],
                ),
              ),
              Figure(formatMoney(approval.amountUnits, approval.asset), color: AppColors.ink, fontSize: 18),
            ],
          ),
          const SizedBox(height: 16),
          const Divider(color: AppColors.paperShade),
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Eyebrow('Why it stopped', onPaper: true),
                    const SizedBox(height: 4),
                    Text(approval.reason,
                        style: const TextStyle(color: AppColors.inkSoft, fontSize: 12)),
                  ],
                ),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Eyebrow('Run and step', onPaper: true),
                    const SizedBox(height: 4),
                    Figure('${approval.runId} / ${approval.stepId}',
                        color: AppColors.inkSoft, fontSize: 11),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: ElevatedButton(
                  onPressed: busy ? null : onApprove,
                  child: const Text('Approve payment'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: OutlinedButton(
                  onPressed: busy ? null : onReject,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.refused,
                    side: const BorderSide(color: AppColors.refused),
                  ),
                  child: const Text('Reject'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
