// Smoke test placeholder.
//
// The app boots by calling Firebase.initializeApp, which requires platform
// channels a widget test has none of. Real coverage for this app belongs in
// widget tests around individual screens (formatMoney, session state,
// primitives) rather than a full pumpWidget(LogisticDigiApp()) smoke test.
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/models.dart';

void main() {
  test('formatMoney renders minor units as a fixed-precision decimal', () {
    expect(formatMoney('12500000', 'USDC'), '12.500000 USDC');
    expect(formatMoney('0', 'USDC'), '0.000000 USDC');
    expect(formatMoney('-500000', 'ALGO'), '-0.500000 ALGO');
  });
}
