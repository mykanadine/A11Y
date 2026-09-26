# CHKT-104 — Accessible Checkout Flow

## Summary

Implement the checkout page for the shopping cart. The page must be fully accessible to keyboard-only users, screen reader users, and users with vestibular disorders.

## Acceptance Criteria

- All interactive elements must be reachable and operable via keyboard (Tab, Enter, Space).
- No `<div>` or `<span>` elements with `onClick` handlers — use semantic `<button>` elements or add `role="button"` + `tabIndex={0}` + `onKeyDown` handlers.
- All form fields must have associated `<label>` elements or `aria-label` attributes.
- Colour contrast for all text must meet WCAG AA (4.5:1 for normal text, 3:1 for large text).
- No auto-playing animations or carousels without pause controls.
- The promo code "Apply" control must be keyboard accessible.
- The "Save this address" toggle must be keyboard accessible.
- Error messages must be announced by screen readers via `aria-live` or `role="alert"`.

## Component

`checkout-a11y-test/src/CheckoutPage.jsx`

## Related

- Design system: IBM Carbon Design System
- WCAG version: 2.2 Level AA
