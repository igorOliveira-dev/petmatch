// npm test — confere as regras compartilhadas (public/regras.js)
const assert = require("node:assert");
const R = require("./public/regras.js");

// máscaras
assert.equal(R.formatar("12345678909", "doc"), "123.456.789-09");
assert.equal(R.formatar("1234", "doc"), "123.4");
assert.equal(R.formatar("112223330001819999", "doc"), "11.222.333/0001-81"); // vira CNPJ e corta o excesso
assert.equal(R.formatar("18600000", "cep"), "18600-000");
assert.equal(R.formatar("14999998888", "whats"), "(14) 99999-8888");
assert.equal(R.formatar("1432221234", "whats"), "(14) 3222-1234");
assert.equal(R.formatar("5", "dinheiro"), "R$ 0,05");
assert.equal(R.formatar("123456", "dinheiro"), "R$ 1.234,56");
assert.equal(R.valorDinheiro("R$ 1.234,56"), 1234.56);
assert.equal(R.dinheiro(50), "R$ 50,00");
// CPF/CNPJ, CEP, WhatsApp
assert.equal(R.docValido("529.982.247-25"), true);
assert.equal(R.docValido("529.982.247-24"), false);
assert.equal(R.docValido("111.111.111-11"), false);
assert.equal(R.docValido("11.222.333/0001-81"), true);
assert.equal(R.docValido("11.222.333/0001-80"), false);
assert.equal(R.cepValido("18600-000"), true);
assert.equal(R.cepValido("1860"), false);
assert.equal(R.whatsValido("(14) 99999-8888"), true);
assert.equal(R.whatsValido("(14) 89999-8888"), false);
// idade (18 anos completos só no dia do aniversário)
const hoje = new Date(2026, 10, 24);
assert.equal(R.idade("2008-11-24", hoje), 18);
assert.equal(R.idade("2008-11-25", hoje), 17);
assert.equal(R.idade("2026-02-31", hoje), null);
assert.equal(R.idade("abc", hoje), null);
// questionário de triagem
const ok = Object.fromEntries(R.QUESTIONARIO.map((q) => [q.id, q.texto ? "Quero dar um lar." : q.opcoes[0]]));
assert.equal(R.validarQuestionario(ok), "");
assert.notEqual(R.validarQuestionario({ ...ok, residencia: "Barco" }), "");
assert.notEqual(R.validarQuestionario({ ...ok, motivo: "curto" }), "");
console.log("regras ok");
