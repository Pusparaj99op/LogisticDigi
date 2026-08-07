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

/// One step of a run, as the orchestrator recorded it.
class RunStep {
  final String stepId;
  final String status;
  final String role;
  final String kind;
  final int attempt;
  final String? error;
  final String? skipReason;
  final int? startedAt;
  final int? completedAt;

  RunStep({
    required this.stepId,
    required this.status,
    required this.role,
    required this.kind,
    required this.attempt,
    this.error,
    this.skipReason,
    this.startedAt,
    this.completedAt,
  });

  factory RunStep.fromDoc(QueryDocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data();
    return RunStep(
      stepId: (data['stepId'] ?? doc.id) as String,
      status: (data['status'] ?? '') as String,
      role: (data['role'] ?? '') as String,
      kind: (data['kind'] ?? '') as String,
      attempt: (data['attempt'] ?? 0) as int,
      error: data['error'] as String?,
      skipReason: data['skipReason'] as String?,
      startedAt: data['startedAt'] as int?,
      completedAt: data['completedAt'] as int?,
    );
  }
}

/// One entry in the immutable audit trail.
///
/// `seq` is a per-run counter rather than a timestamp, so two events in the
/// same millisecond still have a defined order — see the TraceEvent docstring
/// in packages/core/src/runtime/run.ts.
class TraceEvent {
  final int seq;
  final int at;
  final String type;
  final String? stepId;
  final String summary;

  TraceEvent({
    required this.seq,
    required this.at,
    required this.type,
    this.stepId,
    required this.summary,
  });

  factory TraceEvent.fromDoc(QueryDocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data();
    return TraceEvent(
      seq: (data['seq'] ?? 0) as int,
      at: (data['at'] ?? 0) as int,
      type: (data['type'] ?? '') as String,
      stepId: data['stepId'] as String?,
      summary: (data['summary'] ?? '') as String,
    );
  }
}

class Negotiation {
  final String id;
  final String buyerTenantId;
  final String sellerTenantId;
  final String sellerName;
  final String runId;
  final String title;
  final int startedAt;

  Negotiation({
    required this.id,
    required this.buyerTenantId,
    required this.sellerTenantId,
    required this.sellerName,
    required this.runId,
    required this.title,
    required this.startedAt,
  });

  factory Negotiation.fromDoc(QueryDocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data();
    return Negotiation(
      id: doc.id,
      buyerTenantId: (data['buyerTenantId'] ?? '') as String,
      sellerTenantId: (data['sellerTenantId'] ?? '') as String,
      sellerName: (data['sellerName'] ?? '') as String,
      runId: (data['runId'] ?? '') as String,
      title: (data['title'] ?? '') as String,
      startedAt: (data['startedAt'] ?? 0) as int,
    );
  }
}

class AgentMessage {
  final String id;
  final String from;
  final String fromRole;
  final String text;
  final int sentAt;
  final String kind;

  AgentMessage({
    required this.id,
    required this.from,
    required this.fromRole,
    required this.text,
    required this.sentAt,
    required this.kind,
  });

  factory AgentMessage.fromDoc(QueryDocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data();
    return AgentMessage(
      id: doc.id,
      from: (data['from'] ?? '') as String,
      fromRole: (data['fromRole'] ?? '') as String,
      text: (data['text'] ?? '') as String,
      sentAt: (data['sentAt'] ?? 0) as int,
      kind: (data['kind'] ?? 'note') as String,
    );
  }
}

class Shipment {
  final String id;
  final String mode;
  final String status;
  final String originName;
  final String destinationName;
  final double progress;
  final int etaDays;
  final int updatedAt;

  Shipment({
    required this.id,
    required this.mode,
    required this.status,
    required this.originName,
    required this.destinationName,
    required this.progress,
    required this.etaDays,
    required this.updatedAt,
  });

  factory Shipment.fromDoc(QueryDocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data();
    return Shipment(
      id: doc.id,
      mode: (data['mode'] ?? 'truck') as String,
      status: (data['status'] ?? '') as String,
      originName: (data['originName'] ?? '') as String,
      destinationName: (data['destinationName'] ?? '') as String,
      progress: ((data['progress'] ?? 0) as num).toDouble(),
      etaDays: (data['etaDays'] ?? 0) as int,
      updatedAt: (data['updatedAt'] ?? 0) as int,
    );
  }
}

const Map<String, String> shipmentModeLabel = {
  'truck': 'Road',
  'ship': 'Sea',
  'plane': 'Air',
};
