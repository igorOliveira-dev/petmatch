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
| Relatórios em CSV | **Admin:** pets (filtro por status/espécie) e usuários. **Usuário comum:** "Meus pets" e, na Home, a lista de pets disponíveis com os filtros da tela |
| Exibir a importação do relatório | Painel Admin → **Importar pets (CSV)**: mostra o arquivo numa tabela com o resultado de cada linha e só grava depois de confirmar. Aceita o relatório de pets ou o `modelo-importacao-pets.csv` |
| Termo de uso aceito pelo usuário | Caixa "Li e aceito o Termo de Aceite e Condições de Uso" no cadastro; a data do aceite fica salva em `usuarios.aceitou_termos_em` |
| Link para exibir o termo | Rodapé de todas as páginas → `termos.html` |

## Outros recursos

- O dono do pet (ou o admin) pode **editar e excluir** o pet pela página dele
- CPF/CNPJ, CEP e WhatsApp são formatados enquanto se digita e validados (inclusive dígitos verificadores) no navegador e no servidor — regras em `public/formatos.js`, testes com `npm test`
- Saúde do servidor e do banco: `GET /api/saude` (pode ser usado como health check no Coolify)

## Deploy (Coolify)

1. Crie um banco PostgreSQL no Coolify e copie a URL de conexão interna.
2. No app do site, use o build pack **Nixpacks** (detecta o `package.json` e roda `npm start`), porta **3000**.
3. Variáveis de ambiente:
   - `DATABASE_URL` — URL do banco
   - `SEGREDO` — texto longo e aleatório (assina as sessões)
   - `ADMIN_SENHA` — senha do admin criada no primeiro start
