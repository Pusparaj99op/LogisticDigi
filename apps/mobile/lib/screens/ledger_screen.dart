/// The ledger, ported from apps/web/src/app/operations/ledger/page.tsx.
///
/// Every movement of money, in order. Written by the orchestrator and
/// read-only to everyone, including the app — the security rules forbid a
/// client write here.
library;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../live.dart';
import '../models.dart';
import '../session.dart';
import '../theme.dart';
import '../widgets/primitives.dart';

const Map<String, Tone> _kindTone = {
  'reserved': Tone.neutral,
  'settled': Tone.clear,
  'released': Tone.neutral,
  'refunded': Tone.hazard,
};

class LedgerScreen extends StatelessWidget {
  const LedgerScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final tenantId = session.tenantId;
    final dateFormat = DateFormat.yMMMd().add_jm();

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Eyebrow('Ledger'),
        const SizedBox(height: 8),
        const Text('Every movement of money',
            style: TextStyle(fontSize: 26, color: AppColors.chalk, fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        const Text(
          'Written by the orchestrator and read-only to everyone, including us. Settled entries '
          'link to the transaction on Algorand so you can check them yourself.',
          style: TextStyle(color: AppColors.chalkSoft, fontSize: 13),
        ),
        const SizedBox(height: 20),
        if (tenantId == null)
          const EmptyState('Connecting to your workspace.')
        else
          StreamBuilder<List<LedgerEntry>>(
            stream: watchLedger(tenantId),
            builder: (context, snapshot) {
              if (snapshot.hasError) {
                return EmptyState('Could not load the ledger: ${snapshot.error}');
              }
              if (!snapshot.hasData) {
                return const EmptyState('Connecting to your workspace.');
              }
              final entries = snapshot.data!;
              if (entries.isEmpty) {
                return const EmptyState(
                  'No entries yet. Reservations, settlements, and refunds appear here the '
                  'moment an agent moves money.',
                );
              }
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final entry in entries) ...[
                    _LedgerRow(entry: entry, dateFormat: dateFormat),
                    const SizedBox(height: 8),
                  ],
                ],
              );
            },
          ),
      ],
    );
  }
}

class _LedgerRow extends StatelessWidget {
  final LedgerEntry entry;
  final DateFormat dateFormat;

  const _LedgerRow({required this.entry, required this.dateFormat});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.seam),
        borderRadius: BorderRadius.circular(2),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Marker(entry.kind, tone: _kindTone[entry.kind] ?? Tone.neutral),
              Figure(formatMoney(entry.amountUnits, entry.asset), fontSize: 15),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            ledgerKindMeaning[entry.kind] ?? '',
            style: const TextStyle(color: AppColors.chalkFaint, fontSize: 11),
          ),
          const SizedBox(height: 4),
          Text(entry.counterparty, style: const TextStyle(color: AppColors.chalkSoft, fontSize: 12)),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                dateFormat.format(DateTime.fromMillisecondsSinceEpoch(entry.recordedAt)),
                style: tabularStyle(color: AppColors.chalkFaint, fontSize: 11),
              ),
              if (entry.txid != null)
                Text(
                  '${entry.txid!.substring(0, entry.txid!.length > 12 ? 12 : entry.txid!.length)}…',
                  style: tabularStyle(color: AppColors.hazard, fontSize: 11),
                )
              else
                const Text('—', style: TextStyle(color: AppColors.chalkFaint, fontSize: 11)),
            ],
          ),
        ],
      ),
    );
  }
}
