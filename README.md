# PetMatch

Site de adoção de animais: cadastro de usuários (adotante, doador, instituição), registro de pets,
adoção, painel do administrador, relatório CSV e termos de uso.

- **Front-end:** HTML, CSS e JavaScript puro (pasta `public/`)
- **Back-end:** Node.js + Express (`server.js`)
- **Banco de dados:** PostgreSQL (`schema.sql` — as tabelas são criadas automaticamente ao iniciar)

## Como executar no navegador

### Opção 1 — Docker (mais fácil)
```bash
docker compose up
```
Abra http://localhost:3000

### Opção 2 — Node + PostgreSQL instalados
```bash
cp .env.example .env   # e ajuste o DATABASE_URL
npm install
npm start
```
Abra http://localhost:3000

**Login de administrador:** `admin@petmatch.com` / `admin123` (troque com a variável `ADMIN_SENHA` antes do primeiro start).

## Funcionalidades pedidas

| Item | Onde |
|---|---|
| Site | `public/` |
| Banco de dados | `schema.sql` (tabelas `usuarios` e `pets`) |
| Relatório em CSV | Painel Admin → **Baixar relatório CSV** (`GET /api/relatorio.csv`) |
| Exibir a importação do relatório | Painel Admin → **Importar relatório CSV** (mostra o arquivo numa tabela) |
| Termo de uso aceito pelo usuário | Caixa "Li e aceito os termos de uso" no cadastro; a data do aceite fica salva em `usuarios.aceitou_termos_em` |
| Link para exibir o termo | Rodapé de todas as páginas → `termos.html` |

## Deploy (Coolify)

1. Crie um banco PostgreSQL no Coolify e copie a URL de conexão interna.
2. No app do site, use o build pack **Nixpacks** (detecta o `package.json` e roda `npm start`), porta **3000**.
3. Variáveis de ambiente:
   - `DATABASE_URL` — URL do banco
   - `SEGREDO` — texto longo e aleatório (assina as sessões)
   - `ADMIN_SENHA` — senha do admin criada no primeiro start
