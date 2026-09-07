# Edu Biscoito V3.4 — contrato do endpoint de sincronização

O app sempre grava primeiro no aparelho. O endpoint remoto é opcional e só é chamado quando existe conexão.

## Requisição

`POST` para o endpoint configurado na tela **Sincronização**.

Cabeçalhos:
- `Content-Type: application/json`
- `Authorization: Bearer <token>` somente quando o usuário informar um token.

Corpo:

```json
{
  "source": "edu-biscoito-v3.4",
  "deviceId": "dev-...",
  "sentAt": "2026-09-07T15:00:00.000Z",
  "test": false,
  "events": [
    {
      "id": "uuid-unico",
      "eventType": "product.upsert",
      "createdAt": "2026-09-07T14:59:00.000Z",
      "deviceId": "dev-...",
      "payload": {}
    }
  ]
}
```

## Resposta

Qualquer HTTP `2xx` confirma o lote. Só depois dessa confirmação os eventos saem da fila local. Os dados principais permanecem no IndexedDB do aparelho.

Em falha de rede, timeout ou HTTP não-2xx, nada é descartado: o lote continua pendente para nova tentativa.

## Tipos de evento atuais

- `product.upsert`
- `product.delete`
- `stock.clear`
- `transaction.create`
- `cash_session.upsert`
- `snapshot.replace`
- `snapshot.clear`

## Banco remoto

O endpoint pode persistir os eventos em Supabase/PostgreSQL, MySQL, Firebase, D1 ou outro banco. Para segurança, não use credencial administrativa do banco no HTML público; prefira uma API intermediária ou chave pública com permissões mínimas.
