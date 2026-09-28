const approved = new Set([
  '942e6668fd1177524c0fc48b104b0ac3', // historical M0-009 staging proof
  '1443cf6d03d39edae7c101a943c5c684'  // new Optidigi public app
]);
if (!approved.has(process.env.PUBLIC_SHOPIFY_API_KEY))
  throw new Error('Build requires an approved insignia public client ID');
