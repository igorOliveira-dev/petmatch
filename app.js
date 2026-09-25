/* =====================================================
   app.js - funções usadas por TODAS as telas
   Os dados ficam no localStorage do navegador (sem servidor).
   ===================================================== */

/* --- Ler e salvar dados no localStorage --- */
function ler(chave, padrao) {
  const texto = localStorage.getItem(chave);
  return texto ? JSON.parse(texto) : padrao;
}
function salvar(chave, valor) {
  localStorage.setItem(chave, JSON.stringify(valor));
}

/* --- Pets de exemplo (só criados na primeira vez que o site abre) --- */
if (!localStorage.getItem("pets")) {
  const base = {
    vacinacao: "Vacinado",
    situacao: "Castrado",
    especie: "Cachorro",
    cidade: "São Manuel",
    tutor: "Liga do bem",
    tutorEmail: "",
    foto: "",
    adotado: false,
  };
  salvar("pets", [
    { ...base, id: 1, nome: "Luiz", idade: 3, peso: 45, temperamento: "Arisco", sexo: "Macho" },
    { ...base, id: 2, nome: "Pipoca", idade: 2, peso: 4, temperamento: "Brincalhona", sexo: "Fêmea" },
    { ...base, id: 3, nome: "Timão", idade: 1, peso: 30, temperamento: "Sociável", sexo: "Macho" },
    { ...base, id: 4, nome: "Destruidor", idade: 5, peso: 22, temperamento: "Agitado", sexo: "Macho" },
    { ...base, id: 5, nome: "Jurema", idade: 0, peso: 8, temperamento: "Dócil", sexo: "Fêmea" },
    { ...base, id: 6, nome: "Mel", idade: 8, peso: 28, temperamento: "Calma", sexo: "Fêmea" },
  ]);
}

/* --- Administrador padrão (criado automaticamente, não passa pela tela de registro) --- */
const usuariosSalvos = ler("usuarios", []);
if (!usuariosSalvos.some((u) => u.perfil === "admin")) {
  usuariosSalvos.push({ nome: "Administrador", email: "admin@petmatch.com", senha: "admin123", perfil: "admin" });
  salvar("usuarios", usuariosSalvos);
}

/* --- Sessão: quem está logado --- */
function usuarioLogado() {
  return ler("sessao", null);
}
function exigirLogin() {
  // chame no topo das telas privadas
  if (!usuarioLogado()) location.href = "index.html";
}
function exigirAdmin() {
  // chame no topo das telas de administrador
  const u = usuarioLogado();
  if (!u || u.perfil !== "admin") location.href = "home.html";
}
function sair() {
  localStorage.removeItem("sessao");
  location.href = "index.html";
}

/* --- Cabeçalho: cada tela pede um "modo" --- */
function montarCabecalho(modo) {
  let botoes = "";
  if (modo === "registro") botoes = '<a class="btn" href="index.html">FAZER LOGIN</a>';
  const admin = usuarioLogado() && usuarioLogado().perfil === "admin";
  if (modo === "logado")
    botoes =
      (admin ? '<a class="btn" href="admin.html">ADMIN</a>' : "") +
      '<a class="btn" href="registrar-animal.html">REGISTRAR PET</a>' +
      '<a class="btn" href="meus-pets.html">MEUS PETS</a>' +
      '<button class="btn" onclick="sair()">SAIR</button>';
  document.getElementById("cabecalho").innerHTML =
    '<header class="topo"><a class="logo" href="home.html"><img src="./public/logo.jpeg"></img></a><nav>' +
    botoes +
    "</nav></header>";
}

/* --- Grupos de botões de escolha (ex.: SIM / NÃO) --- */
function ativarOpcoes() {
  document.querySelectorAll(".opcoes").forEach((grupo) => {
    grupo.addEventListener("click", (e) => {
      if (e.target.tagName !== "BUTTON") return;
      grupo.querySelectorAll("button").forEach((b) => b.classList.remove("ativo"));
      e.target.classList.add("ativo");
    });
  });
}
// devolve as escolhas de um painel: { nomeDoGrupo: 'valor escolhido' }
function lerOpcoes(painel) {
  const r = {};
  painel.querySelectorAll(".opcoes").forEach((g) => {
    const ativo = g.querySelector(".ativo");
    r[g.dataset.nome] = ativo ? ativo.textContent : "";
  });
  return r;
}

/* --- Estilo de foto (usa a foto do pet ou uma patinha) --- */
function fotoStyle(pet) {
  return pet.foto ? `style="background-image:url('${pet.foto}')"` : "";
}

/* --- Cartão de pet (usado na home e em "meus pets") --- */
function cartaoPet(pet) {
  return `<a class="pet" href="animal.html?id=${pet.id}" ${fotoStyle(pet)}>${pet.foto ? "" : "🐾"}<span>${pet.nome}</span></a>`;
}
