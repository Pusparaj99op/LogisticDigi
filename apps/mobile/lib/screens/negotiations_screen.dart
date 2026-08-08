/// Negotiation transcripts, ported from
/// apps/web/src/app/operations/negotiations/page.tsx.
///
/// Every counterparty in this system is a simulated provider rather than
/// another signed-in tenant, so a thread reads one-sided by construction. It
/// is still the real exchange the negotiation agent had — the messages are
/// generated live by services/orchestrator/src/negotiate-llm.ts, an LLM
/// actually negotiating and deciding the price, not invented dialogue —
/// and NegotiationThread animates a newly-arriving one in as it lands.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../live.dart';
import '../models.dart';
import '../session.dart';
import '../theme.dart';
import '../widgets/negotiation_thread.dart';
import '../widgets/primitives.dart';

class NegotiationsScreen extends StatelessWidget {
  const NegotiationsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final tenantId = session.tenantId;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Eyebrow('Negotiations'),
        const SizedBox(height: 8),
        const Text('What your agents agreed to',
            style: TextStyle(fontSize: 24, color: AppColors.chalk, fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        const Text(
          'The offer a counterparty made, the counter the negotiation agent settled at, '
          'and the acceptance — the real exchange, not a summary of it.',
          style: TextStyle(color: AppColors.chalkSoft, fontSize: 13),
        ),
        const SizedBox(height: 20),
        if (tenantId == null)
          const EmptyState('Connecting to your workspace.')
        else
          StreamBuilder<List<Negotiation>>(
            stream: watchNegotiations(tenantId),
            builder: (context, snap) {
              if (snap.hasError) {
                return EmptyState('Could not load negotiations: ${snap.error}');
              }
              if (!snap.hasData) {
                return const EmptyState('Connecting to your workspace.');
              }
              final negotiations = snap.data!;
              if (negotiations.isEmpty) {
                return const EmptyState(
                  'No negotiations yet. Once an agent quotes and counters a supplier, the '
                  'exchange appears here.',
                );
              }
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final negotiation in negotiations) ...[
                    _NegotiationCard(negotiation: negotiation),
                    const SizedBox(height: 10),
                  ],
                ],
              );
            },
          ),
      ],
    );
  }
}

/// Collapsed by default, streaming its message thread only once opened — one
/// listener per visible transcript rather than one per existing negotiation.
class _NegotiationCard extends StatefulWidget {
  final Negotiation negotiation;
  const _NegotiationCard({required this.negotiation});

  @override
  State<_NegotiationCard> createState() => _NegotiationCardState();
}

class _NegotiationCardState extends State<_NegotiationCard> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final negotiation = widget.negotiation;
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
                        Text(negotiation.sellerName,
                            style: const TextStyle(color: AppColors.chalk, fontSize: 14)),
                        const SizedBox(height: 2),
                        Text(negotiation.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                                color: AppColors.chalkFaint, fontSize: 11)),
                      ],
                    ),
                  ),
                  Icon(_open ? Icons.expand_less : Icons.expand_more,
                      size: 20, color: AppColors.chalkFaint),
                ],
              ),
            ),
          ),
          if (_open)
            Container(
              decoration: const BoxDecoration(
                border: Border(top: BorderSide(color: AppColors.seam)),
              ),
              padding: const EdgeInsets.all(14),
              child: StreamBuilder<List<AgentMessage>>(
                stream: watchNegotiationMessages(negotiation.id),
                builder: (context, snap) {
                  if (snap.hasError) {
                    return Text('Could not load the transcript: ${snap.error}',
                        style: const TextStyle(color: AppColors.chalkFaint, fontSize: 12));
                  }
                  if (!snap.hasData) {
                    return const Text('Loading the transcript.',
                        style: TextStyle(color: AppColors.chalkFaint, fontSize: 12));
                  }
                  final messages = snap.data!;
                  if (messages.isEmpty) {
                    return const Text('No messages recorded for this negotiation.',
                        style: TextStyle(color: AppColors.chalkFaint, fontSize: 12));
                  }
                  return NegotiationThread(threadKey: negotiation.id, messages: messages);
                },
              ),
            ),
        ],
      ),
    );
  }
}
