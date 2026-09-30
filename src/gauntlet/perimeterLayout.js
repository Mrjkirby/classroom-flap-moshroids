export function perimeterSlots(uids, width, height, margin = 20) {
  const sorted = [...uids].sort();
  const counts = [0, 0, 0, 0];
  sorted.forEach((_, index) => { counts[index % 4] += 1; });
  const used = [0, 0, 0, 0];
  return new Map(sorted.map((uid, index) => {
    const side = index % 4;
    const fraction = (++used[side]) / (counts[side] + 1);
    const slot = [
      { x: margin, y: margin, angle: Math.PI / 2 },
      { x: width - margin, y: margin, angle: Math.PI },
      { x: width - margin, y: height - margin, angle: -Math.PI / 2 },
      { x: margin, y: height - margin, angle: 0 }
    ][side];
    if (side === 0 || side === 2) slot.x = margin + fraction * (width - 2 * margin);
    else slot.y = margin + fraction * (height - 2 * margin);
    return [uid, slot];
  }));
}
