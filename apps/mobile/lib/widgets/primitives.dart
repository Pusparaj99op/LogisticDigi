/// Shared UI primitives, ported from apps/web/src/components/primitives.tsx.
///
/// Deliberately few. Two surfaces (floor and paper) and one signature marking
/// (the hazard bar), so screens compose from these rather than inventing new
/// treatments.
library;

import 'package:flutter/material.dart';
import '../theme.dart';

/// The hazard rule: appears once per screen, at the boundary where autonomy
/// stops and a human decision begins. Never decorative.
class HazardBar extends StatelessWidget {
  final String label;
  final bool onPaper;

  const HazardBar({super.key, required this.label, this.onPaper = false});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: label,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            child: CustomPaint(
              size: const Size(double.infinity, 10),
              painter: _HazardPainter(background: onPaper ? AppColors.ink : AppColors.void_),
            ),
          ),
          const SizedBox(height: 8),
          Text(label, style: eyebrowStyle(onPaper: onPaper)),
        ],
      ),
    );
  }
}

class _HazardPainter extends CustomPainter {
  final Color background;
  _HazardPainter({required this.background});

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = background);
    final paint = Paint()..color = AppColors.hazard;
    const stripeWidth = 12.0;
    final diagonal = size.width + size.height;
    for (double x = -size.height; x < diagonal; x += stripeWidth * 2) {
      final path = Path()
        ..moveTo(x, size.height)
        ..lineTo(x + stripeWidth, size.height)
        ..lineTo(x + stripeWidth + size.height, 0)
        ..lineTo(x + size.height, 0)
        ..close();
      canvas.drawPath(path, paint);
    }
  }

  @override
  bool shouldRepaint(covariant _HazardPainter oldDelegate) =>
      oldDelegate.background != background;
}

/// A region label. Names a part of the screen, carries no other meaning.
class Eyebrow extends StatelessWidget {
  final String text;
  final bool onPaper;
  const Eyebrow(this.text, {super.key, this.onPaper = false});

  @override
  Widget build(BuildContext context) => Text(text, style: eyebrowStyle(onPaper: onPaper));
}

/// A panel on the machine floor: live, mechanical, in motion.
class FloorPanel extends StatelessWidget {
  final String? title;
  final Widget? action;
  final Widget child;

  const FloorPanel({super.key, this.title, this.action, required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.steel,
        border: Border.all(color: AppColors.seam),
        borderRadius: BorderRadius.circular(2),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (title != null)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: const BoxDecoration(
                border: Border(bottom: BorderSide(color: AppColors.seam)),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(title!, style: const TextStyle(color: AppColors.chalk, fontSize: 14)),
                  ?action,
                ],
              ),
            ),
          child,
        ],
      ),
    );
  }
}

/// A document. Money and evidence render here — freight paperwork, not a
/// rounded card floating on a dashboard.
class DocumentCard extends StatelessWidget {
  final Widget child;
  const DocumentCard({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(2),
      ),
      child: DefaultTextStyle(
        style: const TextStyle(color: AppColors.ink),
        child: child,
      ),
    );
  }
}

/// A monospace figure: amount, txid, id. Aligns in columns.
class Figure extends StatelessWidget {
  final String text;
  final Color? color;
  final double fontSize;
  const Figure(this.text, {super.key, this.color, this.fontSize = 14});

  @override
  Widget build(BuildContext context) =>
      Text(text, style: tabularStyle(color: color, fontSize: fontSize));
}

/// A status marking. Outline only — filled badges would compete with hazard.
class Marker extends StatelessWidget {
  final String text;
  final Tone tone;
  const Marker(this.text, {super.key, this.tone = Tone.neutral});

  @override
  Widget build(BuildContext context) {
    final color = toneColor(tone);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(border: Border.all(color: color), borderRadius: BorderRadius.circular(2)),
      child: Text(
        text.toUpperCase(),
        style: tabularStyle(color: color, fontSize: 11),
      ),
    );
  }
}

/// An empty state. Says what will fill the screen and how — never just "no
/// data".
class EmptyState extends StatelessWidget {
  final String text;
  const EmptyState(this.text, {super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 32),
      child: Text(text, style: const TextStyle(color: AppColors.chalkFaint, fontSize: 13)),
    );
  }
}
