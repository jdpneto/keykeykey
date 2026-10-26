import { act, fireEvent } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';

/**
 * Press an element whose onPress handler is async, and wait for it to finish
 * — inside act().
 *
 * RNTL 14's `fireEvent` returns the handler's return value, so
 * `await fireEvent.press(el)` on an async handler already waits for the
 * handler's promise. But only the synchronous part of the handler runs inside
 * fireEvent's own act() scope. Every setState after the handler's first
 * `await` (a mocked vault call resolving, the 50 ms "let the spinner paint"
 * yield, …) runs after that scope has closed, which React reports as "An
 * update to <Component> inside a test was not wrapped in act(...)".
 *
 * Wrapping the press in an outer act() keeps the act scope open until the
 * handler has reached its terminal state, so all of its updates are batched
 * and flushed by act() rather than racing the test.
 */
export async function pressAndSettle(element: TestInstance): Promise<void> {
  await act(async () => {
    await fireEvent.press(element);
  });
}
