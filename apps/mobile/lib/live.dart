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
