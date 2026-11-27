# PetMatch

Site de adoção de cães e gatos que conecta adotantes a ONGs e protetores de Botucatu e região.

**Acesse:** https://petmatch.bitemenu.com.br

**Stack:** HTML/CSS/JS puro (`public/`) · Node.js + Express (`server.js`) · PostgreSQL (`schema.sql`, aplicado sozinho no start)

## Rodar

```bash
docker compose up        # site + banco em http://localhost:3000
```

Sem Docker: `cp .env.example .env`, ajuste o `DATABASE_URL`, depois `npm install && npm start`.

Admin: `admin@petmatch.com` / `admin123` (troque com `ADMIN_SENHA` antes do primeiro start). Testes: `npm test`.

## Funcionalidades

- **Adotantes:** solicitam a adoção pelo questionário de triagem (e-mail confirmado, 18+ e no máximo 3 solicitações em análise) e acompanham ou cancelam em *Solicitações*.
- **ONGs/protetores:** enviam documentação para homologação e, depois de aprovados, cadastram pets. Respondem às solicitações seguindo o fluxo entrevista → parecer → aprovar/reprovar com justificativa; o prazo de 7 dias para o primeiro retorno aparece em destaque. Ao aprovar, o site registra quem adotou.
- **Admin:** homologa parceiros, suspende contas, recebe mensagens e denúncias, vê os prazos vencidos e a auditoria, e importa pets por CSV.
- **Relatórios CSV:** pets, usuários e solicitações, conforme o perfil de quem baixa.
- **LGPD:** *Meus dados* permite consultar, corrigir, exportar (JSON) e excluir a conta.
- **Termo de uso:** `termos.html`, com aceite no cadastro. Ao editar o termo, mude `TERMO_VERSAO` em `server.js` para que todos sejam avisados.

## Deploy (Coolify)

Build pack Nixpacks, porta `3000`, e estas variáveis:

| Variável | Para quê |
|---|---|
| `DATABASE_URL` | Conexão com o PostgreSQL |
| `SEGREDO` | Texto longo e aleatório (assina sessões e links) |
| `ADMIN_SENHA` | Senha do admin no primeiro start |
| `SITE_URL` | Endereço público, usado nos links dos e-mails |
| `SMTP_URL`, `EMAIL_REMETENTE` | Envio de e-mails. Sem eles, os e-mails só aparecem no log |

Health check: `GET /api/saude`.
