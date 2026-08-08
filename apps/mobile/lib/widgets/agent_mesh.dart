import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../theme.dart';
import '../live.dart';

/// Agent mesh — every agent connected to every other agent, sticky-note
/// style, matching the reference board (image/networkdemo.jpg): irregular
/// boxes with a dense web of connecting lines through the center. Mobile
/// equivalent of apps/web/src/components/agent-mesh.tsx — same node layout,
/// same "lit dashed line means actually talking right now" rule.
class AgentMesh extends StatefulWidget {
  final Map<String, AgentActivity> activity;
  const AgentMesh({super.key, required this.activity});

  @override
  State<AgentMesh> createState() => _AgentMeshState();
}

class _AgentMeshState extends State<AgentMesh> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: const Duration(seconds: 1))..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AspectRatio(
      aspectRatio: 640 / 380,
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) => CustomPaint(
          painter: _MeshPainter(activity: widget.activity, t: _controller.value),
          size: Size.infinite,
        ),
      ),
    );
  }
}

class _MeshNode {
  final String id;
  final String label;
  final String sub;
  final double x, y; // fraction of width/height
  final double rotateDeg;
  final bool major;
  const _MeshNode(this.id, this.label, this.sub, this.x, this.y, this.rotateDeg, this.major);
}

const List<_MeshNode> _nodes = [
  _MeshNode('major', 'MAJOR AGENT', 'holds the goal', 0.5, 0.14, -2, true),
  _MeshNode('inventory', 'INVENTORY', 'own stock only', 0.12, 0.32, -4, false),
  _MeshNode('procurement', 'PROCUREMENT', 'read the catalogue', 0.82, 0.28, 3, false),
  _MeshNode('negotiation', 'NEGOTIATION', 'talks to counterparties', 0.06, 0.68, 5, false),
  _MeshNode('compliance', 'COMPLIANCE', 'verify and veto', 0.9, 0.7, -3, false),
  _MeshNode('settlement', 'SETTLEMENT', 'moves funds, capped', 0.35, 0.86, 2, false),
  _MeshNode('logistics', 'LOGISTICS', 'book and track cargo', 0.65, 0.88, -5, false),
];

class _MeshPainter extends CustomPainter {
  final Map<String, AgentActivity> activity;
  final double t;
  _MeshPainter({required this.activity, required this.t});

  bool _busy(String id) {
    if (id == 'major') return activity.values.any((a) => a.activity == 'working');
    return activity[id]?.activity == 'working';
  }

  @override
  void paint(Canvas canvas, Size size) {
    Offset pos(_MeshNode n) => Offset(n.x * size.width, n.y * size.height);

    for (var i = 0; i < _nodes.length; i++) {
      for (var j = i + 1; j < _nodes.length; j++) {
        final a = _nodes[i], b = _nodes[j];
        final busy = _busy(a.id) || _busy(b.id);
        final paint = Paint()
          ..color = (busy ? AppColors.hazard : AppColors.seam).withValues(alpha: busy ? 0.85 : 0.35)
          ..strokeWidth = busy ? 1.5 : 1;
        if (busy) {
          _dashedLine(canvas, pos(a), pos(b), paint, t);
        } else {
          canvas.drawLine(pos(a), pos(b), paint);
        }
      }
    }

    for (final n in _nodes) {
      final busy = _busy(n.id);
      final boxW = n.major ? 118.0 : 108.0;
      const boxH = 46.0;
      final center = pos(n);
      canvas.save();
      canvas.translate(center.dx, center.dy);
      canvas.rotate(n.rotateDeg * math.pi / 180);
      final rect = Rect.fromCenter(center: Offset.zero, width: boxW, height: boxH);
      final fillPaint = Paint()
        ..color = n.major ? const Color(0xFFF5D97A) : const Color(0xFFD9635A);
      canvas.drawRect(rect, fillPaint);
      final borderPaint = Paint()
        ..style = PaintingStyle.stroke
        ..color = busy ? AppColors.hazard : Colors.black.withValues(alpha: 0.25)
        ..strokeWidth = busy ? 2 : 1;
      canvas.drawRect(rect, borderPaint);

      final labelPainter = TextPainter(
        text: TextSpan(
          text: n.label,
          style: const TextStyle(color: Color(0xFF1A1512), fontSize: 9.5, fontWeight: FontWeight.w700),
        ),
        textDirection: TextDirection.ltr,
      )..layout(maxWidth: boxW - 6);
      labelPainter.paint(canvas, Offset(-labelPainter.width / 2, -14));

      final subPainter = TextPainter(
        text: TextSpan(text: n.sub, style: const TextStyle(color: Color(0xFF3A2F28), fontSize: 7.5)),
        textDirection: TextDirection.ltr,
      )..layout(maxWidth: boxW - 6);
      subPainter.paint(canvas, Offset(-subPainter.width / 2, -1));

      if (busy) {
        final pulse = Paint()..color = AppColors.hazard.withValues(alpha: 0.3 + 0.7 * (0.5 + 0.5 * math.sin(t * 2 * math.pi)));
        canvas.drawCircle(Offset(boxW / 2 - 8, -boxH / 2 + 8), 4, pulse);
      }
      canvas.restore();
    }
  }

  void _dashedLine(Canvas canvas, Offset a, Offset b, Paint paint, double t) {
    const dashLen = 4.0, gapLen = 3.0;
    final total = (b - a).distance;
    final dir = (b - a) / total;
    final offset = (t * 14) % (dashLen + gapLen);
    var dist = -offset;
    while (dist < total) {
      final start = (dist).clamp(0.0, total);
      final end = (dist + dashLen).clamp(0.0, total);
      if (end > start) canvas.drawLine(a + dir * start, a + dir * end, paint);
      dist += dashLen + gapLen;
    }
  }

  @override
  bool shouldRepaint(covariant _MeshPainter oldDelegate) =>
      oldDelegate.t != t || oldDelegate.activity != activity;
}
