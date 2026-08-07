/// Live Firestore streams, ported from apps/web/src/components/live.ts.
///
/// Every collection here is server-written and client-read: the security
/// rules (firebase/firestore.rules) forbid a tenant writing its own runs,
/// traces, receipts, or ledger. These streams therefore only ever read.
library;

import 'package:cloud_firestore/cloud_firestore.dart';
import 'models.dart';

Stream<List<RunSummary>> watchRuns(String tenantId, {int max = 20}) {
  return FirebaseFirestore.instance
      .collection('runs')
      .where('tenantId', isEqualTo: tenantId)
      .orderBy('createdAt', descending: true)
      .limit(max)
      .snapshots()
      .map((snap) => snap.docs.map(RunSummary.fromDoc).toList());
}

Stream<List<ApprovalRequest>> watchPendingApprovals(String tenantId) {
  return FirebaseFirestore.instance
      .collection('approvals')
      .where('tenantId', isEqualTo: tenantId)
      .where('status', isEqualTo: 'pending')
      .orderBy('requestedAt', descending: true)
      .snapshots()
      .map((snap) => snap.docs.map(ApprovalRequest.fromDoc).toList());
}

Stream<List<LedgerEntry>> watchLedger(String tenantId, {int max = 100}) {
  return FirebaseFirestore.instance
      .collection('ledger')
      .where('tenantId', isEqualTo: tenantId)
      .orderBy('recordedAt', descending: true)
      .limit(max)
      .snapshots()
      .map((snap) => snap.docs.map(LedgerEntry.fromDoc).toList());
}

Stream<List<RunStep>> watchRunSteps(String runId) {
  return FirebaseFirestore.instance
      .collection('runs')
      .doc(runId)
      .collection('steps')
      .snapshots()
      .map((snap) => snap.docs.map(RunStep.fromDoc).toList());
}

/// The immutable audit trail, ordered by its own sequence counter rather than
/// by timestamp — see TraceEvent in models.dart.
Stream<List<TraceEvent>> watchRunTrace(String runId, {int max = 300}) {
  return FirebaseFirestore.instance
      .collection('runs')
      .doc(runId)
      .collection('trace')
      .orderBy('seq')
      .limit(max)
      .snapshots()
      .map((snap) => snap.docs.map(TraceEvent.fromDoc).toList());
}

/// Negotiations this tenant is the buyer in. Every counterparty here is a
/// simulated provider rather than another signed-in tenant, so the buyer side
/// is the one that matches a real session.
Stream<List<Negotiation>> watchNegotiations(String tenantId, {int max = 20}) {
  return FirebaseFirestore.instance
      .collection('negotiations')
      .where('buyerTenantId', isEqualTo: tenantId)
      .orderBy('startedAt', descending: true)
      .limit(max)
      .snapshots()
      .map((snap) => snap.docs.map(Negotiation.fromDoc).toList());
}

Stream<List<AgentMessage>> watchNegotiationMessages(String negotiationId, {int max = 100}) {
  return FirebaseFirestore.instance
      .collection('negotiations')
      .doc(negotiationId)
      .collection('messages')
      .orderBy('sentAt')
      .limit(max)
      .snapshots()
      .map((snap) => snap.docs.map(AgentMessage.fromDoc).toList());
}

/// Shipments this tenant bought.
///
/// Filtered by buyerTenantId rather than fetched unfiltered: Firestore
/// evaluates security rules against the *query*, not its results, so a query
/// with no tenant predicate is rejected outright by the memberOf check on
/// /shipments in firebase/firestore.rules.
Stream<List<Shipment>> watchShipments(String tenantId, {int max = 50}) {
  return FirebaseFirestore.instance
      .collection('shipments')
      .where('buyerTenantId', isEqualTo: tenantId)
      .orderBy('updatedAt', descending: true)
      .limit(max)
      .snapshots()
      .map((snap) => snap.docs.map(Shipment.fromDoc).toList());
}

/// The rules accept only these four fields on an approval, only while it is
/// still pending, and only attributed to the signed-in user — see
/// firebase/firestore.rules, match /approvals/{approvalId}.
Future<void> decideApproval({
  required String approvalId,
  required bool approved,
  required String decidedByUid,
}) {
  return FirebaseFirestore.instance.collection('approvals').doc(approvalId).update({
    'status': approved ? 'approved' : 'rejected',
    'decidedBy': decidedByUid,
    'decidedAt': DateTime.now().millisecondsSinceEpoch,
    'note': approved ? 'Approved from the mobile console' : 'Rejected by the operator',
  });
}
