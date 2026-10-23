// ESLint の設定（Next.js 16 で next lint が無くなったため、ESLint を直接使う形式に移した）
import coreWebVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...coreWebVitals,
  {
    // eslint-config-next 16 で増えた React Compiler 向けの規則。このアプリは React Compiler を使っておらず、
    // Next.js 14 のときの検査（next lint）には無かったので、これまでと同じ範囲の検査にそろえる
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/purity": "off",
      "react-hooks/immutability": "off",
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
  { ignores: ["docs/**", ".next/**", "node_modules/**", "android/**", "ios/**", "mobile/**", "public/**"] },
];

export default config;
