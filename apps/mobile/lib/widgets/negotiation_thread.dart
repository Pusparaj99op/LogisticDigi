/// A negotiation transcript that reveals itself the way it happened, ported
/// from apps/web/src/components/negotiation-thread.tsx — history renders
/// instantly (no replaying a closed deal every time the screen opens), but a
/// message that just arrived from Firestore gets a short "composing" pulse
/// and then types itself out character by character. The dialogue underneath
/// is real: generated live by services/orchestrator/src/negotiate-llm.ts, an
/// LLM actually negotiating and deciding the price, not a script.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import '../models.dart';
import '../theme.dart';
import 'primitives.dart';

const Map<String, Tone> _kindTone = {
  'proposal': Tone.neutral,
  'counter': Tone.hazard,
  'accept': Tone.clear,
  'reject': Tone.refused,
  'note': Tone.neutral,
};

const _composeHold = Duration(milliseconds: 550);
const _msPerChar = Duration(milliseconds: 16);

class NegotiationThread extends StatefulWidget {
  /// Changes whenever the selected/expanded negotiation changes, so the
  /// animation state resets cleanly instead of animating stale history.
  final String threadKey;
  final List<AgentMessage> messages;

  const NegotiationThread({super.key, required this.threadKey, required this.messages});

  @override
  State<NegotiationThread> createState() => _NegotiationThreadState();
}

class _NegotiationThreadState extends State<NegotiationThread> {
  final Set<String> _seenIds = {};
  String? _knownThread;
  final List<AgentMessage> _settled = [];
  final List<AgentMessage> _queue = [];
  // The message currently composing/typing, if any — held separately from
  // `_queue` because it is dequeued the instant it starts animating.
  AgentMessage? _current;
  bool _composing = false;
  String _typed = '';
  bool _processing = false;
  Timer? _composeTimer;
  Timer? _typeTimer;

  @override
  void initState() {
    super.initState();
    _syncMessages();
  }

  @override
  void didUpdateWidget(NegotiationThread old) {
    super.didUpdateWidget(old);
    if (old.threadKey != widget.threadKey || old.messages != widget.messages) {
      _syncMessages();
    }
  }

  void _syncMessages() {
    if (_knownThread != widget.threadKey) {
      _knownThread = widget.threadKey;
      _composeTimer?.cancel();
      _typeTimer?.cancel();
      _processing = false;
      _seenIds
        ..clear()
        ..addAll(widget.messages.map((m) => m.id));
      setState(() {
        _settled
          ..clear()
          ..addAll(widget.messages);
        _queue.clear();
        _composing = false;
        _typed = '';
      });
      return;
    }

    final fresh = widget.messages.where((m) => !_seenIds.contains(m.id)).toList();
    if (fresh.isEmpty) return;
    _seenIds.addAll(fresh.map((m) => m.id));
    setState(() => _queue.addAll(fresh));
    _pump();
  }

  void _pump() {
    if (_processing || _queue.isEmpty) return;
    _processing = true;
    final next = _queue.removeAt(0);

    setState(() {
      _current = next;
      _composing = true;
      _typed = '';
    });

    _composeTimer = Timer(_composeHold, () {
      if (!mounted) return;
      setState(() => _composing = false);
      var shown = 0;
      _typeTimer = Timer.periodic(_msPerChar, (timer) {
        if (!mounted) {
          timer.cancel();
          return;
        }
        shown += 1;
        setState(() => _typed = next.text.substring(0, shown.clamp(0, next.text.length)));
        if (shown >= next.text.length) {
          timer.cancel();
          setState(() {
            _settled.add(next);
            _current = null;
            _typed = '';
          });
          _processing = false;
          _pump();
        }
      });
    });
  }

  @override
  void dispose() {
    _composeTimer?.cancel();
    _typeTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final pending = _current;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final message in _settled) _MessageRow(message: message),
        if (pending != null) _PendingRow(message: pending, composing: _composing, typed: _typed),
      ],
    );
  }
}

class _MessageRow extends StatelessWidget {
  final AgentMessage message;
  const _MessageRow({required this.message});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.only(left: 10),
      decoration: const BoxDecoration(
        border: Border(left: BorderSide(color: AppColors.seam, width: 2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Marker(message.kind, tone: _kindTone[message.kind] ?? Tone.neutral),
              const SizedBox(width: 8),
              Expanded(
                child: Text(message.from, maxLines: 1, overflow: TextOverflow.ellipsis, style: eyebrowStyle()),
              ),
            ],
          ),
          const SizedBox(height: 5),
          Text(message.text, style: const TextStyle(color: AppColors.chalkSoft, fontSize: 12)),
        ],
      ),
    );
  }
}

class _PendingRow extends StatefulWidget {
  final AgentMessage message;
  final bool composing;
  final String typed;
  const _PendingRow({required this.message, required this.composing, required this.typed});

  @override
  State<_PendingRow> createState() => _PendingRowState();
}

/// A small pulsing dot in place of the web version's Lottie indicator — no
/// animation package is installed on mobile, and a single AnimatedContainer
/// loop needs none.
class _PendingRowState extends State<_PendingRow> with SingleTickerProviderStateMixin {
  late final AnimationController _pulse;

  @override
  void initState() {
    super.initState();
    _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 700))..repeat(reverse: true);
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final message = widget.message;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.only(left: 10),
      decoration: const BoxDecoration(
        border: Border(left: BorderSide(color: AppColors.hazard, width: 2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Marker(message.kind, tone: _kindTone[message.kind] ?? Tone.neutral),
              const SizedBox(width: 8),
              Expanded(
                child: Text(message.from, maxLines: 1, overflow: TextOverflow.ellipsis, style: eyebrowStyle()),
              ),
              if (widget.composing)
                FadeTransition(
                  opacity: _pulse,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 6,
                        height: 6,
                        margin: const EdgeInsets.only(right: 6),
                        decoration: const BoxDecoration(color: AppColors.hazard, shape: BoxShape.circle),
                      ),
                      Text('composing…', style: eyebrowStyle()),
                    ],
                  ),
                ),
            ],
          ),
          if (!widget.composing) ...[
            const SizedBox(height: 5),
            Text('${widget.typed}▌', style: const TextStyle(color: AppColors.chalkSoft, fontSize: 12)),
          ],
        ],
      ),
    );
  }
}
