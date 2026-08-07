/// Sign-in, ported from apps/web/src/app/sign-in/page.tsx.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../session.dart';
import '../theme.dart';
import '../widgets/primitives.dart';

class SignInScreen extends StatefulWidget {
  const SignInScreen({super.key});

  @override
  State<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends State<SignInScreen> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _registering = false;
  bool _busy = false;
  String? _error;

  Future<void> _attempt(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (cause) {
      setState(() => _error = Session.describeError(cause));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final session = context.read<Session>();

    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Eyebrow('LogisticDigi'),
              const SizedBox(height: 16),
              const Text(
                'YOUR AGENTS\nNEGOTIATE.',
                style: TextStyle(
                  fontSize: 34,
                  fontWeight: FontWeight.w700,
                  height: 1.0,
                  color: AppColors.chalk,
                ),
              ),
              const Text(
                'YOU DECIDE.',
                style: TextStyle(
                  fontSize: 34,
                  fontWeight: FontWeight.w700,
                  height: 1.0,
                  color: AppColors.hazard,
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                'Specialist agents find surplus stock, bargain with other companies, and '
                'settle on Algorand. Every decision they make, and every action they were '
                'stopped from taking, is on the record.',
                style: TextStyle(color: AppColors.chalkSoft, fontSize: 14, height: 1.5),
              ),
              const SizedBox(height: 32),
              Text(
                _registering ? 'Create an account' : 'Sign in',
                style: const TextStyle(fontSize: 22, color: AppColors.chalk),
              ),
              const SizedBox(height: 8),
              Text(
                _registering
                    ? 'You will join a workspace once an administrator adds you.'
                    : 'Use your Google account, or an email and password.',
                style: const TextStyle(color: AppColors.chalkSoft, fontSize: 13),
              ),
              const SizedBox(height: 24),
              ElevatedButton(
                onPressed: _busy ? null : () => _attempt(session.signInWithGoogle),
                child: const Text('Continue with Google'),
              ),
              const SizedBox(height: 24),
              Row(
                children: [
                  const Expanded(child: Divider(color: AppColors.seam)),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: Text('or', style: eyebrowStyle()),
                  ),
                  const Expanded(child: Divider(color: AppColors.seam)),
                ],
              ),
              const SizedBox(height: 24),
              TextField(
                controller: _emailController,
                keyboardType: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.email],
                decoration: const InputDecoration(labelText: 'Email'),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _passwordController,
                obscureText: true,
                autofillHints: [_registering ? AutofillHints.newPassword : AutofillHints.password],
                decoration: const InputDecoration(labelText: 'Password'),
              ),
              if (_error != null) ...[
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.only(left: 12),
                  decoration: const BoxDecoration(
                    border: Border(left: BorderSide(color: AppColors.refused, width: 2)),
                  ),
                  child: Text(_error!, style: const TextStyle(color: AppColors.refused, fontSize: 13)),
                ),
              ],
              const SizedBox(height: 20),
              OutlinedButton(
                onPressed: _busy
                    ? null
                    : () => _attempt(() => _registering
                        ? session.registerWithPassword(_emailController.text, _passwordController.text)
                        : session.signInWithPassword(_emailController.text, _passwordController.text)),
                child: Text(_registering ? 'Create account' : 'Sign in'),
              ),
              const SizedBox(height: 16),
              Center(
                child: TextButton(
                  onPressed: () => setState(() {
                    _registering = !_registering;
                    _error = null;
                  }),
                  child: Text(
                    _registering ? 'I already have an account' : 'Create an account instead',
                    style: const TextStyle(color: AppColors.chalkFaint),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
