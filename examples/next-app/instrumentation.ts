export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { register } = await import('@tracethrough/next');
    const handle = register();
    console.log(`App Connect: ${handle?.enabled ? 'enabled' : `disabled (${handle?.disabledReason ?? 'not Node runtime'})`}`);
  }
}
