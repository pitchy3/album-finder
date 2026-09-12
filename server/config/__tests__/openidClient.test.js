describe('OpenID client configuration', () => {
  it('sets a centralized 10-second HTTP timeout', () => {
    const setHttpOptionsDefaults = jest.fn();

    jest.isolateModules(() => {
      jest.doMock('openid-client', () => ({
        custom: { setHttpOptionsDefaults },
      }));

      require('../openidClient');
    });

    expect(setHttpOptionsDefaults).toHaveBeenCalledTimes(1);
    expect(setHttpOptionsDefaults).toHaveBeenCalledWith({ timeout: 10000 });
    expect(console.log).toHaveBeenCalledWith('OIDC HTTP timeout configured: 10000ms');
  });
});
