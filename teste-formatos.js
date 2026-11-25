// npm test — confere máscaras e validação de CPF/CNPJ, CEP e WhatsApp
const assert = require("node:assert");
const { formatar, docValido, cepValido, whatsValido } = require("./public/formatos.js");

assert.equal(formatar("12345678909", "doc"), "123.456.789-09");
assert.equal(formatar("1234", "doc"), "123.4");
assert.equal(formatar("112223330001819999", "doc"), "11.222.333/0001-81"); // vira CNPJ e corta o excesso
assert.equal(formatar("18600000", "cep"), "18600-000");
assert.equal(formatar("14999998888", "whats"), "(14) 99999-8888");
assert.equal(formatar("1432221234", "whats"), "(14) 3222-1234");
assert.equal(docValido("529.982.247-25"), true);
assert.equal(docValido("529.982.247-24"), false);
assert.equal(docValido("111.111.111-11"), false);
assert.equal(docValido("11.222.333/0001-81"), true);
assert.equal(docValido("11.222.333/0001-80"), false);
assert.equal(cepValido("18600-000"), true);
assert.equal(cepValido("1860"), false);
assert.equal(whatsValido("(14) 99999-8888"), true);
assert.equal(whatsValido("(14) 89999-8888"), false);
console.log("formatos ok");
