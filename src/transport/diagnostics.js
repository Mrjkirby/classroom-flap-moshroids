export function reportTransportDiagnostic(event, details = {}) {
  console.info('[MOSHROIDS transport]', { event, ...details });
}
