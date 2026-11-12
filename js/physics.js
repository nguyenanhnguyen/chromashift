/**
 * physics.js — ChromaShift Color Physics Engine
 *
 * Mô hình: ánh sáng tương tác với bề mặt vật thể theo công thức nhân kênh màu.
 * Reflected(R,G,B) = Light(R,G,B) × Object(R,G,B) / 255
 *
 * Mỗi điểm trên bề mặt nhận một mức chiếu sáng tùy theo góc giữa
 * pháp tuyến bề mặt và hướng ánh sáng (dot product).
 */
const Physics = (() => {
  'use strict';

  /* ─── Utilities ─── */

  const clamp = (v, lo = 0, hi = 255) => Math.max(lo, Math.min(hi, v));

  const hexToRgb = hex => ({
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  });

  const rgbToHex = ({ r, g, b }) =>
    '#' + [r, g, b].map(v => clamp(Math.round(v)).toString(16).padStart(2, '0')).join('');

  /** css rgb(...) string */
  const toCss = ({ r, g, b }) =>
    `rgb(${clamp(Math.round(r))},${clamp(Math.round(g))},${clamp(Math.round(b))})`;

  /* ─── Core math ─── */

  /**
   * Component-wise multiply: đây là phép tính màu phản xạ vật lý.
   * Ánh sáng đỏ chiếu lên vật xanh → không có phản xạ nào cả.
   */
  const reflect = (lightHex, objectHex) => {
    const L = hexToRgb(lightHex);
    const O = hexToRgb(objectHex);
    return {
      r: (L.r * O.r) / 255,
      g: (L.g * O.g) / 255,
      b: (L.b * O.b) / 255,
    };
  };

  /** Scale RGB bởi một hệ số [0, 1] */
  const scale = ({ r, g, b }, f) => ({ r: r * f, g: g * f, b: b * f });

  /** Linear interpolate giữa hai màu, t ∈ [0, 1] */
  const lerp = (a, b, t) => ({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  });

  /**
   * Tính toán các vùng sáng-tối trên bề mặt vật thể.
   *
   * @param {string} lightHex  - màu nguồn sáng
   * @param {string} objectHex - màu thuần của vật thể (pigment)
   * @param {number} intensity - cường độ ánh sáng [0, 1] (giảm theo khoảng cách)
   * @param {number} metallic  - độ kim loại [0, 1]:
   *   0 = hoàn toàn matte (khuếch tán), 1 = hoàn toàn metallic (phản chiếu)
   *
   * Vật liệu matte:
   *   - Ánh sáng tán xạ đều theo mọi hướng (Lambertian diffuse)
   *   - Highlight rộng, mềm
   *   - Bóng sáng (specular) gần như trắng
   *
   * Vật liệu metallic:
   *   - Phản xạ gương: highlight cực nhỏ và sắc nét
   *   - Màu highlight = màu nguồn sáng (không bị trắng hóa)
   *   - Vùng tối tối hơn (ít ambient hơn)
   *   - Toàn bề mặt nhuốm màu ánh sáng nhiều hơn
   *
   * @returns {{ lit, midLight, objectNatural, shadow, reflected, specular, objRgb }}
   */
  const computeLighting = (lightHex, objectHex, intensity = 1.0, metallic = 0.0) => {
    const reflected  = reflect(lightHex, objectHex);
    const objRgb     = hexToRgb(objectHex);
    const lightRgb   = hexToRgb(lightHex);

    // Màu lit: vật liệu metallic sẽ nhuốm thêm màu ánh sáng
    const metallicBlend = metallic * 0.55;
    const litBase  = lerp(reflected, scale(lightRgb, intensity), metallicBlend);
    const lit      = scale(litBase, intensity);

    // Midtone: blend từ màu tự nhiên sang màu lit
    const midLight = lerp(objRgb, lit, 0.5 + metallic * 0.1);

    // Ambient: metallic có ambient thấp hơn rất nhiều
    const ambientBase = 0.12 - metallic * 0.09;
    const objectNatural = scale(objRgb, ambientBase + 0.07 * intensity);

    // Shadow: metallic tối hơn (ít photon tán xạ hơn)
    const shadow = scale(objRgb, 0.04 - metallic * 0.025);

    // ── Specular highlight (điểm sáng chói) ──
    // Matte: specular trắng, nhỏ
    // Metallic: specular = màu ánh sáng, rất sắc nét
    const specularColor = lerp({ r: 255, g: 255, b: 255 }, lightRgb, metallic);
    // Cường độ specular tăng theo metallic
    const specularStrength = Math.min(1.0, intensity * (0.4 + metallic * 0.8));
    const specular = scale(specularColor, specularStrength);

    return { lit, midLight, objectNatural, shadow, reflected, specular, objRgb };
  };

  /**
   * Tính cường độ ánh sáng theo khoảng cách (inverse-square law, đã chuẩn hóa).
   * @param {number} distNorm - khoảng cách normalize [0 … √2]
   */
  const intensityFromDistance = (distNorm) =>
    clamp(0.22 / (distNorm * distNorm + 0.07), 0.18, 1.0);

  /* ─── Public API ─── */
  return {
    hexToRgb,
    rgbToHex,
    toCss,
    reflect,
    scale,
    lerp,
    computeLighting,
    intensityFromDistance,
  };
})();
