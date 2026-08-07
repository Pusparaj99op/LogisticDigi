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
