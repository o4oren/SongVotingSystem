import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Tests never talk to a real Firebase project.
vi.mock('../lib/firebase.js', () => ({ auth: {}, db: {}, googleProvider: {} }));

afterEach(() => cleanup());
