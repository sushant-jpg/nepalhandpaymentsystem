# Postman API verification

Import the collection and local environment, start the Docker stack, run `npm run seed`, and set the environment's `demo_password` to the password used for seeding. Keep Postman's cookie jar enabled because refresh-token rotation uses an HTTP-only cookie.

Run folders in numeric order. The happy path saves access tokens, payment IDs, confirmation tokens, transaction IDs, and refund IDs automatically. Palm enrollment and identification need three enrollment data URLs plus a probe in the `palm_sample_*` and `palm_probe` secret variables. Ordinary RGB palm recognition is an educational prototype.

CLI smoke run:

```bash
npm run test:postman
```

For the full stateful flow, provide secrets without committing them:

```bash
newman run postman/NepalHandPaymentSystem.postman_collection.json \
  -e postman/NepalHandPaymentSystem.local.postman_environment.json \
  --env-var demo_password="$DEMO_PASSWORD" \
  --env-var palm_sample_1="$PALM_SAMPLE_1" \
  --env-var palm_sample_2="$PALM_SAMPLE_2" \
  --env-var palm_sample_3="$PALM_SAMPLE_3" \
  --env-var palm_probe="$PALM_PROBE"
```

The default npm smoke command runs the `00 Health` folder only so CI can validate a live stack without biometric fixtures or seeded credentials. Never point this collection at production: it creates demo payments, refunds, and administrative credits.
