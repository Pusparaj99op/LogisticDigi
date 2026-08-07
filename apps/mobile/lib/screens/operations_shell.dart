/// Operations shell: the section navigation, ported from
/// apps/web/src/app/operations/layout.tsx.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../session.dart';
import '../theme.dart';
import 'approvals_screen.dart';
import 'floor_screen.dart';
import 'ledger_screen.dart';
import 'negotiations_screen.dart';
import 'runs_screen.dart';

class OperationsShell extends StatefulWidget {
  const OperationsShell({super.key});

  @override
  State<OperationsShell> createState() => _OperationsShellState();
}

class _OperationsShellState extends State<OperationsShell> {
  int _index = 0;

  void _goTo(int index) => setState(() => _index = index);

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final screens = [
      FloorScreen(onNavigate: _goTo),
      const RunsScreen(),
      const ApprovalsScreen(),
      const NegotiationsScreen(),
      const LedgerScreen(),
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('LogisticDigi', style: TextStyle(fontSize: 16, letterSpacing: 1.2)),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Center(
              child: Text(
                session.tenantId ?? 'no workspace yet',
                style: const TextStyle(color: AppColors.chalkFaint, fontSize: 11),
              ),
            ),
          ),
          IconButton(
            tooltip: 'Sign out',
            icon: const Icon(Icons.logout, size: 20),
            onPressed: () => session.leave(),
          ),
        ],
      ),
      body: IndexedStack(index: _index, children: screens),
      bottomNavigationBar: NavigationBar(
        backgroundColor: AppColors.void_,
        indicatorColor: AppColors.hazardWash,
        selectedIndex: _index,
        onDestinationSelected: _goTo,
        destinations: const [
          NavigationDestination(icon: Icon(Icons.dashboard_outlined), label: 'Floor'),
          NavigationDestination(icon: Icon(Icons.timeline_outlined), label: 'Runs'),
          NavigationDestination(icon: Icon(Icons.gavel_outlined), label: 'Approvals'),
          NavigationDestination(icon: Icon(Icons.forum_outlined), label: 'Deals'),
          NavigationDestination(icon: Icon(Icons.receipt_long_outlined), label: 'Ledger'),
        ],
      ),
    );
  }
}
