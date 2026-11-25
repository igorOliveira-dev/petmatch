/* =====================================================
   formatos.js - máscaras e validação de CPF/CNPJ, CEP e telefone.
   Usado no navegador (registro) E no servidor (server.js), assim as regras são as mesmas.
   ===================================================== */

// "0" = um dígito; o resto é copiado como está
const PADROES = {
  doc: (d) => (d.length <= 11 ? "000.000.000-00" : "00.000.000/0000-00"),
  cep: () => "00000-000",
  whats: (d) => (d.length <= 10 ? "(00) 0000-0000" : "(00) 00000-0000"),
};
const MAX_DIGITOS = { doc: 14, cep: 8, whats: 11 };

// formatar("12345678909", "doc") -> "123.456.789-09"
function formatar(valor, tipo) {
  const d = String(valor ?? "").replace(/\D/g, "").slice(0, MAX_DIGITOS[tipo]);
  let r = "", i = 0;
  for (const c of PADROES[tipo](d)) {
    if (i >= d.length) break;
    r += c === "0" ? d[i++] : c;
  }
  return r;
}

// confere os dígitos verificadores de CPF (11) ou CNPJ (14)
function docValido(valor) {
  const d = String(valor ?? "").replace(/\D/g, "");
  if (!/^(\d{11}|\d{14})$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  const dv = (pesos) => { const r = pesos.reduce((t, p, i) => t + d[i] * p, 0) % 11; return r < 2 ? 0 : 11 - r; };
  if (d.length === 11) return dv([10, 9, 8, 7, 6, 5, 4, 3, 2]) == d[9] && dv([11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) == d[10];
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  return dv(p1) == d[12] && dv([6, ...p1]) == d[13];
}

const cepValido = (v) => /^\d{8}$/.test(String(v ?? "").replace(/\D/g, ""));
const whatsValido = (v) => /^[1-9]{2}9?\d{8}$/.test(String(v ?? "").replace(/\D/g, ""));

if (typeof module !== "undefined") module.exports = { formatar, docValido, cepValido, whatsValido };
