# Testing Guide

## Running Tests

### Unit Tests
```bash
# Run all unit tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

### Integration Tests
```bash
npm run test:integration
```

### E2E Tests
```bash
# Run all E2E tests
npm run test:e2e

# Run with UI
npm run test:e2e:ui

# Run specific test
npx playwright test search-flow.spec.js
```

### Performance Tests
```bash
npm run test:performance
npm run test:load
```

## Test Structure
```
├── server/
│   ├── __tests__/
│   │   ├── fixtures/          # Test data
│   │   ├── helpers/           # Test utilities
│   │   ├── integration/       # Integration tests
│   │   ├── performance/       # Performance tests
│   │   └── unit/              # Unit tests
│   └── services/__tests__/    # Service-specific tests
│
├── client/
│   └── src/
│       ├── components/__tests__/  # Component tests
│       ├── hooks/__tests__/       # Hook tests
│       └── services/__tests__/    # Service tests
│
└── e2e/                      # End-to-end tests
    ├── helpers/              # E2E test utilities
    └── *.spec.js             # E2E test specs
```

## Writing Tests

### Unit Test Example
```javascript
describe('Component', () => {
  it('should render correctly', () => {
    // Arrange
    const props = { ... };
    
    // Act
    const result = render(<Component {...props} />);
    
    // Assert
    expect(result).toBeDefined();
  });
});
```

### E2E Test Example
```javascript
test('user flow', async ({ page }) => {
  await page.goto('/');
  await page.getByText('Click me').click();
  await expect(page.getByText('Success')).toBeVisible();
});
```

## CI/CD Integration

Tests run automatically on:
- Pull requests
- Pushes to main/develop branches
- Manual workflow dispatch

See `.github/workflows/test.yml` for details.