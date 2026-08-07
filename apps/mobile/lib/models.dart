/// Data models mirroring apps/web/src/components/live.ts and
/// packages/core/src/money.ts. Amounts stay as decimal strings end to end —
/// Firestore, the wire, and this app never touch a float for money.
library;

import 'package:cloud_firestore/cloud_firestore.dart';

const Map<String, int> _assetDecimals = {'USDC': 6, 'ALGO': 6};

/// Render minor units (as stored, e.g. "12500000") as "12.500000 USDC".
///
/// BigInt rather than double: a run's settled total or a ledger amount must
/// render exactly, not approximately, or the figure is not evidence.
String formatMoney(String unitsRaw, String asset) {
  final decimals = _assetDecimals[asset] ?? 6;
  final negative = unitsRaw.startsWith('-');
  final digits = negative ? unitsRaw.substring(1) : unitsRaw;
  final units = BigInt.tryParse(digits.isEmpty ? '0' : digits) ?? BigInt.zero;
  final divisor = BigInt.from(10).pow(decimals);
  final whole = units ~/ divisor;
  final fraction = (units % divisor).toString().padLeft(decimals, '0');
  return '${negative ? '-' : ''}$whole.$fraction $asset';
}

class RunSummary {
  final String id;
  final String tenantId;
  final String goal;
  final String status;
  final int createdAt;
  final String? settledUnits;

  RunSummary({
    required this.id,
    required this.tenantId,
    required this.goal,
    required this.status,
    required this.createdAt,
    this.settledUnits,
  });

  factory RunSummary.fromDoc(QueryDocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data();
    return RunSummary(
      id: doc.id,
      tenantId: (data['tenantId'] ?? '') as String,
      goal: (data['goal'] ?? '') as String,
      status: (data['status'] ?? '') as String,
      createdAt: (data['createdAt'] ?? 0) as int,
      settledUnits: data['settledUnits'] as String?,
    );
  }
}

class ApprovalRequest {
  final String id;
  final String tenantId;
  final String runId;
  final String stepId;
  final String status;
  final String amountUnits;
  final String asset;
  final String counterparty;
  final String description;
  final String reason;
  final int requestedAt;

  ApprovalRequest({
    required this.id,
    required this.tenantId,
    required this.runId,
    required this.stepId,
    required this.status,
    required this.amountUnits,
    required this.asset,
    required this.counterparty,
    required this.description,
    required this.reason,
    required this.requestedAt,
  });

  factory ApprovalRequest.fromDoc(QueryDocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data();
    return ApprovalRequest(
      id: doc.id,
      tenantId: (data['tenantId'] ?? '') as String,
      runId: (data['runId'] ?? '') as String,
      stepId: (data['stepId'] ?? '') as String,
      status: (data['status'] ?? 'pending') as String,
      amountUnits: (data['amountUnits'] ?? '0').toString(),
      asset: (data['asset'] ?? 'USDC') as String,
      counterparty: (data['counterparty'] ?? '') as String,
      description: (data['description'] ?? '') as String,
      reason: (data['reason'] ?? '') as String,
      requestedAt: (data['requestedAt'] ?? 0) as int,
    );
  }
}

class LedgerEntry {
  final String id;
  final String tenantId;
  final String runId;
  final String stepId;
  final String kind;
  final String amountUnits;
  final String asset;
  final String counterparty;
  final String? txid;
  final String? explorerUrl;
  final int recordedAt;

  LedgerEntry({
    required this.id,
    required this.tenantId,
    required this.runId,
    required this.stepId,
    required this.kind,
    required this.amountUnits,
    required this.asset,
    required this.counterparty,
    this.txid,
    this.explorerUrl,
    required this.recordedAt,
  });

  factory LedgerEntry.fromDoc(QueryDocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data();
    return LedgerEntry(
      id: doc.id,
      tenantId: (data['tenantId'] ?? '') as String,
      runId: (data['runId'] ?? '') as String,
      stepId: (data['stepId'] ?? '') as String,
      kind: (data['kind'] ?? '') as String,
      amountUnits: (data['amountUnits'] ?? '0').toString(),
      asset: (data['asset'] ?? 'USDC') as String,
      counterparty: (data['counterparty'] ?? '') as String,
      txid: data['txid'] as String?,
      explorerUrl: data['explorerUrl'] as String?,
      recordedAt: (data['recordedAt'] ?? 0) as int,
    );
  }
}

const Map<String, String> ledgerKindMeaning = {
  'reserved': 'earmarked, not yet paid',
  'settled': 'paid on chain',
  'released': 'earmark returned unused',
  'refunded': 'recovered from the counterparty',
};
