const shouldSilenceLogs =
  process.env.ENABLE_SERVER_LOGS !== 'true' &&
  process.env.NODE_ENV === 'production';

if (shouldSilenceLogs) {
  const noop = () => {};
  console.log = noop;
  console.info = noop;
  console.debug = noop;
}


