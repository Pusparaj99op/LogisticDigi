/// Session state, ported from apps/web/src/lib/auth-context.tsx.
///
/// Carries the tenant and role from Firebase Auth custom claims rather than a
/// Firestore lookup, for the same reason the security rules read claims: they
/// are signed by Auth and cannot be edited by the client.
library;

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';

class Session extends ChangeNotifier {
  User? user;
  String? tenantId;
  String? role;
  bool platformOwner = false;
  bool loading = true;

  Session() {
    // idTokenChanges rather than authStateChanges: claims change when a user
    // switches tenant, and only the token stream reflects that.
    FirebaseAuth.instance.idTokenChanges().listen(_onIdToken);
  }

  Future<void> _onIdToken(User? nextUser) async {
    if (nextUser == null) {
      user = null;
      tenantId = null;
      role = null;
      platformOwner = false;
      loading = false;
      notifyListeners();
      return;
    }
    final result = await nextUser.getIdTokenResult();
    user = nextUser;
    tenantId = result.claims?['tenantId'] as String?;
    role = (result.claims?['role'] as String?) ?? 'member';
    platformOwner = result.claims?['platformOwner'] == true;
    loading = false;
    notifyListeners();
  }

  Future<void> signInWithGoogle() async {
    final googleUser = await GoogleSignIn().signIn();
    if (googleUser == null) {
      throw FirebaseAuthException(code: 'popup-closed', message: 'Sign-in was cancelled.');
    }
    final googleAuth = await googleUser.authentication;
    final credential = GoogleAuthProvider.credential(
      accessToken: googleAuth.accessToken,
      idToken: googleAuth.idToken,
    );
    await FirebaseAuth.instance.signInWithCredential(credential);
  }

  Future<void> signInWithPassword(String email, String password) async {
    await FirebaseAuth.instance.signInWithEmailAndPassword(email: email, password: password);
  }

  Future<void> registerWithPassword(String email, String password) async {
    await FirebaseAuth.instance.createUserWithEmailAndPassword(email: email, password: password);
  }

  Future<void> leave() async {
    await FirebaseAuth.instance.signOut();
    await GoogleSignIn().signOut();
  }

  /// Same wording as the web app's sign-in error mapping, so operators moving
  /// between the console and the app see one voice.
  static String describeError(Object cause) {
    final code = cause is FirebaseAuthException ? cause.code : '';
    if (code.contains('invalid-credential') || code.contains('wrong-password')) {
      return 'That email and password do not match an account. Check both, or create an account.';
    }
    if (code.contains('email-already-in-use')) {
      return 'An account already exists for that email. Sign in instead.';
    }
    if (code.contains('weak-password')) {
      return 'Passwords need at least six characters.';
    }
    if (code.contains('popup-closed')) {
      return 'The Google window closed before sign-in finished. Try again.';
    }
    return cause is FirebaseAuthException ? (cause.message ?? cause.code) : cause.toString();
  }
}
