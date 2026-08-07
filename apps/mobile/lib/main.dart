import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'firebase_options.dart';
import 'screens/operations_shell.dart';
import 'screens/sign_in_screen.dart';
import 'session.dart';
import 'theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  String? initError;
  try {
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);

    // Point at a local `firebase emulators:start` instead of the real
    // project. Opt-in and compiled in, so a store build cannot be talked into
    // connecting to a developer's machine.
    //
    // Over USB — works with Wi-Fi off, and the emulators stay on loopback:
    //     adb reverse tcp:8080 tcp:8080 && adb reverse tcp:9099 tcp:9099
    //     flutter run --dart-define=EMULATOR_HOST=127.0.0.1
    // Over Wi-Fi, pass the host machine's LAN address instead (and bind the
    // emulators to 0.0.0.0 so they accept it).
    //
    // automaticHostMapping: false is essential. FlutterFire otherwise
    // rewrites "127.0.0.1"/"localhost" to 10.0.2.2 on Android — the *Android
    // emulator's* alias for its host, which is unroutable on a real handset,
    // so the adb-reverse tunnel would be silently bypassed and every query
    // would hang rather than fail.
    const emulatorHost = String.fromEnvironment('EMULATOR_HOST');
    if (emulatorHost.isNotEmpty) {
      FirebaseFirestore.instance
          .useFirestoreEmulator(emulatorHost, 8080, automaticHostMapping: false);
      await FirebaseAuth.instance
          .useAuthEmulator(emulatorHost, 9099, automaticHostMapping: false);
      debugPrint('[logisticdigi] using Firebase emulators at $emulatorHost');
    }
  } catch (cause) {
    // Mirrors apps/web's firebaseConfigured check: a missing/placeholder
    // config produces a clear in-app message rather than a crash.
    initError = cause.toString();
  }

  runApp(LogisticDigiApp(configError: initError));
}

class LogisticDigiApp extends StatelessWidget {
  final String? configError;
  const LogisticDigiApp({super.key, this.configError});

  @override
  Widget build(BuildContext context) {
    if (configError != null) {
      return MaterialApp(
        title: 'LogisticDigi',
        theme: buildAppTheme(),
        home: _NotConfiguredScreen(error: configError!),
      );
    }

    return ChangeNotifierProvider(
      create: (_) => Session(),
      child: MaterialApp(
        title: 'LogisticDigi',
        theme: buildAppTheme(),
        home: const _Root(),
      ),
    );
  }
}

class _Root extends StatelessWidget {
  const _Root();

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();

    if (session.loading) {
      return const Scaffold(
        body: Center(
          child: Text('LOADING', style: TextStyle(color: AppColors.chalkFaint, letterSpacing: 2)),
        ),
      );
    }

    return session.user == null ? const SignInScreen() : const OperationsShell();
  }
}

class _NotConfiguredScreen extends StatelessWidget {
  final String error;
  const _NotConfiguredScreen({required this.error});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Firebase is not configured',
                    style: TextStyle(fontSize: 20, color: AppColors.chalk)),
                const SizedBox(height: 12),
                const Text(
                  'Run flutterfire configure from apps/mobile to register this app against the '
                  'logisticdigi Firebase project, then rebuild.',
                  style: TextStyle(color: AppColors.chalkSoft, fontSize: 14),
                ),
                const SizedBox(height: 16),
                Text(error, style: const TextStyle(color: AppColors.chalkFaint, fontSize: 11)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
