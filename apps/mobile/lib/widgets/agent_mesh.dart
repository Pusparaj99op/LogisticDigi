import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../theme.dart';
import '../live.dart';

/// Agent mesh — every agent connected to every other agent, sticky-note
/// style, matching the reference board (image/networkdemo.jpg): irregular
/// boxes with a dense web of connecting lines through the center. Mobile
/// twin of apps/web/src/components/agent-mesh.tsx — same node layout, same
/// corrected colors, same "one lit, arrowed, moving line means who is
/// actually talking right now" rule, plus tap-for-details.
class AgentMesh extends StatefulWidget {
  final Map<String, AgentActivity> activity;
  final ({String caller, String listener})? callerListener;
  const AgentMesh({super.key, required this.activity, this.callerListener});

  @override
  State<AgentMesh> createState() => _AgentMeshState();
}

class _AgentMeshState extends State<AgentMesh> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  String? _selectedId;

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

  void _handleTapUp(TapUpDetails details, Size size) {
    for (final node in _nodes) {
      final center = Offset(node.x * size.width, node.y * size.height);
      final boxW = node.major ? 122.0 : 112.0;
      const boxH = 48.0;
      final rect = Rect.fromCenter(center: center, width: boxW + 16, height: boxH + 16);
      if (rect.contains(details.localPosition)) {
        setState(() => _selectedId = node.id);
        _showDetails(node);
        return;
      }
    }
  }

  void _showDetails(_MeshNode node) {
    final activity = widget.activity[node.id];
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.steelRaised,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(2)),
      ),
      builder: (context) => Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(node.label, style: const TextStyle(color: AppColors.chalk, fontSize: 16, fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            Text(node.sub, style: TextStyle(color: AppColors.chalkSoft, fontSize: 13)),
            if (activity != null) ...[
              const SizedBox(height: 10),
              Text(activity.detail, style: const TextStyle(color: AppColors.hazard, fontSize: 12)),
            ],
          ],
        ),
      ),
    ).whenComplete(() => setState(() => _selectedId = null));
  }

  @override
  Widget build(BuildContext context) {
    return AspectRatio(
      aspectRatio: 640 / 440,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final size = Size(constraints.maxWidth, constraints.maxHeight);
          return GestureDetector(
            onTapUp: (details) => _handleTapUp(details, size),
            child: AnimatedBuilder(
              animation: _controller,
              builder: (context, _) => CustomPaint(
                painter: _MeshPainter(
                  activity: widget.activity,
                  callerListener: widget.callerListener,
                  t: _controller.value,
                  selectedId: _selectedId,
                ),
                size: Size.infinite,
              ),
            ),
          );
        },
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
  _MeshNode('major', 'MAJOR AGENT', 'holds the goal', 0.5, 0.15, -2, true),
  _MeshNode('inventory', 'INVENTORY', 'own stock only', 0.16, 0.34, -4, false),
  _MeshNode('procurement', 'PROCUREMENT', 'read the catalogue', 0.78, 0.3, 3, false),
  _MeshNode('negotiation', 'NEGOTIATION', 'talks to counterparties', 0.11, 0.66, 5, false),
  _MeshNode('compliance', 'COMPLIANCE', 'verify and veto', 0.85, 0.68, -3, false),
  _MeshNode('settlement', 'SETTLEMENT', 'moves funds, capped', 0.36, 0.85, 2, false),
  _MeshNode('logistics', 'LOGISTICS', 'book and track cargo', 0.64, 0.85, -5, false),
];

class _MeshPainter extends CustomPainter {
  final Map<String, AgentActivity> activity;
  final ({String caller, String listener})? callerListener;
  final double t;
  final String? selectedId;
  _MeshPainter({required this.activity, required this.callerListener, required this.t, this.selectedId});

  bool _busy(String id) {
    if (id == 'major') return activity.values.any((a) => a.activity == 'working');
    return activity[id]?.activity == 'working';
  }

  @override
  void paint(Canvas canvas, Size size) {
    Offset pos(_MeshNode n) => Offset(n.x * size.width, n.y * size.height);
    final focusId = selectedId;

    for (var i = 0; i < _nodes.length; i++) {
      for (var j = i + 1; j < _nodes.length; j++) {
        final a = _nodes[i], b = _nodes[j];
        final isFocusEdge = focusId != null && (a.id == focusId || b.id == focusId);
        final dimmed = focusId != null && !isFocusEdge;
        final paint = Paint()
          ..color = (isFocusEdge ? AppColors.chalkSoft : AppColors.seam)
              .withValues(alpha: dimmed ? 0.1 : (isFocusEdge ? 0.7 : 0.35))
          ..strokeWidth = isFocusEdge ? 1.5 : 1;
        canvas.drawLine(pos(a), pos(b), paint);
      }
    }

    final cl = callerListener;
    if (cl != null) {
      final a = _nodeById(cl.caller);
      final b = _nodeById(cl.listener);
      if (a != null && b != null) {
        final pa = pos(a), pb = pos(b);
        final edgePaint = Paint()
          ..color = AppColors.hazard
          ..strokeWidth = 2.5
          ..style = PaintingStyle.stroke;
        _dashedLine(canvas, pa, pb, edgePaint, t);
        _arrowHead(canvas, pa, pb, AppColors.hazard);

        final dir = (pb - pa) / (pb - pa).distance;
        final travel = pa + (pb - pa) * t;
        canvas.drawCircle(travel, 4.5, Paint()..color = AppColors.hazard);
        // small trailing fade dot for motion cue
        final trail = travel - dir * 10;
        canvas.drawCircle(trail, 2.5, Paint()..color = AppColors.hazard.withValues(alpha: 0.4));
      }
    }

    for (final n in _nodes) {
      final busy = _busy(n.id);
      final isFocus = focusId == n.id;
      final dimmed = focusId != null && !isFocus;
      final boxW = n.major ? 122.0 : 112.0;
      const boxH = 48.0;
      final center = pos(n);
      canvas.save();
      canvas.translate(center.dx, center.dy);
      canvas.rotate(n.rotateDeg * math.pi / 180);

      final boxAlpha = dimmed ? 0.45 : 1.0;
      final rect = Rect.fromCenter(center: const Offset(0, 0), width: boxW, height: boxH);
      if (!dimmed) canvas.drawShadow(Path()..addRect(rect), Colors.black, 3, false);

      final fillPaint = Paint()
        ..color = (n.major ? AppColors.hazard : const Color(0xFFE8635A)).withValues(alpha: boxAlpha);
      canvas.drawRect(rect, fillPaint);
      final borderPaint = Paint()
        ..style = PaintingStyle.stroke
        ..color = (busy || isFocus ? AppColors.hazard : Colors.black).withValues(alpha: boxAlpha * (busy || isFocus ? 1 : 0.3))
        ..strokeWidth = busy || isFocus ? 2 : 1;
      canvas.drawRect(rect, borderPaint);

      final labelPainter = TextPainter(
        text: TextSpan(
          text: n.label,
          style: TextStyle(color: const Color(0xFF1A1512).withValues(alpha: boxAlpha), fontSize: 9.5, fontWeight: FontWeight.w700),
        ),
        textDirection: TextDirection.ltr,
      )..layout(maxWidth: boxW - 6);
      labelPainter.paint(canvas, Offset(-labelPainter.width / 2, -15));

      final subPainter = TextPainter(
        text: TextSpan(text: n.sub, style: TextStyle(color: const Color(0xFF3A2F28).withValues(alpha: boxAlpha), fontSize: 7.5)),
        textDirection: TextDirection.ltr,
      )..layout(maxWidth: boxW - 6);
      subPainter.paint(canvas, Offset(-subPainter.width / 2, -1));

      if (busy) {
        final pulse = Paint()
          ..color = const Color(0xFF1A1512)
              .withValues(alpha: boxAlpha * (0.3 + 0.7 * (0.5 + 0.5 * math.sin(t * 2 * math.pi))));
        canvas.drawCircle(Offset(boxW / 2 - 8, -boxH / 2 + 8), 4, pulse);
      }
      canvas.restore();
    }
  }

  _MeshNode? _nodeById(String id) {
    for (final n in _nodes) {
      if (n.id == id) return n;
    }
    return null;
  }

  void _dashedLine(Canvas canvas, Offset a, Offset b, Paint paint, double t) {
    const dashLen = 6.0, gapLen = 4.0;
    final total = (b - a).distance;
    final dir = (b - a) / total;
    final offset = (t * 20) % (dashLen + gapLen);
    var dist = -offset;
    while (dist < total) {
      final start = (dist).clamp(0.0, total);
      final end = (dist + dashLen).clamp(0.0, total);
      if (end > start) canvas.drawLine(a + dir * start, a + dir * end, paint);
      dist += dashLen + gapLen;
    }
  }

  void _arrowHead(Canvas canvas, Offset a, Offset b, Color color) {
    final dir = (b - a) / (b - a).distance;
    final normal = Offset(-dir.dy, dir.dx);
    // Stop short of the listener box so the arrow doesn't bury itself under it.
    final tip = b - dir * 30;
    final left = tip - dir * 10 + normal * 5;
    final right = tip - dir * 10 - normal * 5;
    final path = Path()
      ..moveTo(tip.dx, tip.dy)
      ..lineTo(left.dx, left.dy)
      ..lineTo(right.dx, right.dy)
      ..close();
    canvas.drawPath(path, Paint()..color = color);
  }

  @override
  bool shouldRepaint(covariant _MeshPainter oldDelegate) =>
      oldDelegate.t != t ||
      oldDelegate.activity != activity ||
      oldDelegate.callerListener != callerListener ||
      oldDelegate.selectedId != selectedId;
}
