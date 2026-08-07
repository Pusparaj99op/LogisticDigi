// GENERATE THIS FILE — do not fill in the placeholders below by hand.
//
// Run, from apps/mobile, after `firebase login`:
//   dart pub global activate flutterfire_cli
//   flutterfire configure --project=logisticdigi
//
// That registers Android/iOS/web apps against the `logisticdigi` Firebase
// project (see .env.example at the repo root for the project id) and
// overwrites this file with real values. The web app's config is public by
// design (see .env.example) but Android/iOS app ids are separate
// registrations this repo cannot fabricate, so this file ships as a stub
// until `flutterfire configure` has been run once.

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart' show TargetPlatform, defaultTargetPlatform, kIsWeb;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) return web;
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        return ios;
      default:
        throw UnsupportedError(
          'DefaultFirebaseOptions have not been configured for this platform. '
          'Run `flutterfire configure` from apps/mobile.',
        );
    }
  }

  static const web = FirebaseOptions(
    apiKey: 'AIzaSyAadfnJszpgiPUoqslGfirIFXiAV1k0W6k',
    appId: '1:732824107426:web:9a948327a1e18b7328dafb',
    messagingSenderId: '732824107426',
    projectId: 'logisticdigi',
    authDomain: 'logisticdigi.firebaseapp.com',
    storageBucket: 'logisticdigi.firebasestorage.app',
  );

  // Placeholders: run `flutterfire configure` to replace these with the
  // registered Android/iOS app ids and (for Android) the real API key.
  static const android = FirebaseOptions(
    apiKey: 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE',
    appId: 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE',
    messagingSenderId: '732824107426',
    projectId: 'logisticdigi',
    storageBucket: 'logisticdigi.firebasestorage.app',
  );

  static const ios = FirebaseOptions(
    apiKey: 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE',
    appId: 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE',
    messagingSenderId: '732824107426',
    projectId: 'logisticdigi',
    storageBucket: 'logisticdigi.firebasestorage.app',
    iosBundleId: 'com.logisticdigi.mobile',
  );
}
