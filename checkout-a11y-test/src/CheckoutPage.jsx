import React, { useState } from "react";

/**
 * CheckoutPage — Demo fixture for A11y-Agent testing (CHKT-104)
 *
 * This file intentionally contains two accessibility violations:
 *   Line 162 — <span> with onClick but no role/tabIndex (promo apply button)
 *   Line 325 — <span> with onClick but no role/tabIndex (save address toggle)
 *
 * All other interactive elements are correctly implemented for comparison.
 */

export default function CheckoutPage() {
  const [promoCode, setPromoCode] = useState("");
  const [promoStatus, setPromoStatus] = useState(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [zip, setZip] = useState("");
  const [country, setCountry] = useState("US");
  const [saveAddress, setSaveAddress] = useState(false);
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [errors, setErrors] = useState({});

  const cartItems = [
    { id: 1, name: "Wireless Headphones", qty: 1, price: 79.99 },
    { id: 2, name: "USB-C Cable (2m)", qty: 2, price: 9.99 },
    { id: 3, name: "Phone Stand", qty: 1, price: 14.99 },
  ];

  const subtotal = cartItems.reduce((sum, i) => sum + i.qty * i.price, 0);
  const shipping = 5.99;
  const total = subtotal + shipping;

  function applyPromo() {
    if (promoCode.trim().toUpperCase() === "SAVE10") {
      setPromoStatus("Promo code applied: 10% off");
    } else {
      setPromoStatus("Invalid promo code");
    }
  }

  function validate() {
    const e = {};
    if (!firstName.trim()) e.firstName = "First name is required";
    if (!lastName.trim()) e.lastName = "Last name is required";
    if (!address.trim()) e.address = "Address is required";
    if (!city.trim()) e.city = "City is required";
    if (!zip.trim()) e.zip = "ZIP code is required";
    if (!cardNumber.trim()) e.cardNumber = "Card number is required";
    if (!expiry.trim()) e.expiry = "Expiry date is required";
    if (!cvv.trim()) e.cvv = "CVV is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (validate()) {
      alert("Order placed successfully!");
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="checkout-page">
      <h1>Checkout</h1>

      {/* ── Cart summary ── */}
      <section aria-labelledby="cart-heading">
        <h2 id="cart-heading">Order Summary</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Qty</th>
              <th scope="col">Price</th>
            </tr>
          </thead>
          <tbody>
            {cartItems.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.qty}</td>
                <td>${(item.qty * item.price).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>Subtotal</td>
              <td>${subtotal.toFixed(2)}</td>
            </tr>
            <tr>
              <td colSpan={2}>Shipping</td>
              <td>${shipping.toFixed(2)}</td>
            </tr>
            <tr>
              <td colSpan={2}>
                <strong>Total</strong>
              </td>
              <td>
                <strong>${total.toFixed(2)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      {/* ── Promo code ── */}
      <section aria-labelledby="promo-heading">
        <h2 id="promo-heading">Promo Code</h2>
        <div className="promo-row">
          <label htmlFor="promo-input">Enter promo code</label>
          <input
            id="promo-input"
            type="text"
            value={promoCode}
            onChange={(e) => setPromoCode(e.target.value)}
            aria-describedby={promoStatus ? "promo-status" : undefined}
          />
          {/* ⚠️  ACCESSIBILITY VIOLATION — line 162
               This <span> has an onClick but no role, tabIndex, or onKeyDown.
               Keyboard users cannot Tab to it or activate it.
               Fix: add role="button" tabIndex={0} onKeyDown handler,
               or replace with a <button> element.                          */}
          <span className="promo-apply-btn" onClick={applyPromo}>
              Apply
            </span>
        </div>
        {promoStatus && (
          <p id="promo-status" role="status">
            {promoStatus}
          </p>
        )}
      </section>

      {/* ── Shipping address ── */}
      <form onSubmit={handleSubmit} noValidate>
        <section aria-labelledby="shipping-heading">
          <h2 id="shipping-heading">Shipping Address</h2>

          <div className="field-row">
            <label htmlFor="first-name">First name</label>
            <input
              id="first-name"
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              aria-invalid={!!errors.firstName}
              aria-describedby={errors.firstName ? "fn-error" : undefined}
            />
            {errors.firstName && (
              <span id="fn-error" role="alert" className="error">
                {errors.firstName}
              </span>
            )}
          </div>

          <div className="field-row">
            <label htmlFor="last-name">Last name</label>
            <input
              id="last-name"
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              aria-invalid={!!errors.lastName}
              aria-describedby={errors.lastName ? "ln-error" : undefined}
            />
            {errors.lastName && (
              <span id="ln-error" role="alert" className="error">
                {errors.lastName}
              </span>
            )}
          </div>

          <div className="field-row">
            <label htmlFor="address">Street address</label>
            <input
              id="address"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              aria-invalid={!!errors.address}
            />
          </div>

          <div className="field-row">
            <label htmlFor="city">City</label>
            <input
              id="city"
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              aria-invalid={!!errors.city}
            />
          </div>

          <div className="field-row">
            <label htmlFor="zip">ZIP / Postal code</label>
            <input
              id="zip"
              type="text"
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              aria-invalid={!!errors.zip}
            />
          </div>

          <div className="field-row">
            <label htmlFor="country">Country</label>
            <select
              id="country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            >
              <option value="US">United States</option>
              <option value="CA">Canada</option>
              <option value="GB">United Kingdom</option>
              <option value="DE">Germany</option>
            </select>
          </div>

          {/* Save address toggle row */}
          <div className="save-address-row">
            <div
              className="custom-checkbox"
              role="checkbox"
              aria-checked={saveAddress}
              tabIndex={0}
              onClick={() => setSaveAddress((v) => !v)}
              onKeyDown={(e) =>
                (e.key === "Enter" || e.key === " ") &&
                setSaveAddress((v) => !v)
              }
            >
              {saveAddress && <span className="checkmark">✓</span>}
            </div>
            {/* ⚠️  ACCESSIBILITY VIOLATION — line 325
                 This <span> has an onClick but no role, tabIndex, or onKeyDown.
                 The checkbox div above is correct; this label span is not.
                 Fix: add role="button" tabIndex={0} onKeyDown handler,
                 or make it a plain <label> associated with the checkbox.    */}
            <span className="save-address-label" onClick={() => setSaveAddress((v) => !v)}>
                Save this address for future orders
              </span>
          </div>
        </section>

        {/* ── Payment ── */}
        <section aria-labelledby="payment-heading">
          <h2 id="payment-heading">Payment</h2>

          <div className="field-row">
            <label htmlFor="card-number">Card number</label>
            <input
              id="card-number"
              type="text"
              inputMode="numeric"
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
              aria-invalid={!!errors.cardNumber}
              placeholder="1234 5678 9012 3456"
            />
            {errors.cardNumber && (
              <span role="alert" className="error">
                {errors.cardNumber}
              </span>
            )}
          </div>

          <div className="field-row">
            <label htmlFor="expiry">Expiry date</label>
            <input
              id="expiry"
              type="text"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              placeholder="MM/YY"
              aria-invalid={!!errors.expiry}
            />
          </div>

          <div className="field-row">
            <label htmlFor="cvv">CVV</label>
            <input
              id="cvv"
              type="text"
              inputMode="numeric"
              value={cvv}
              onChange={(e) => setCvv(e.target.value)}
              aria-describedby="cvv-hint"
              aria-invalid={!!errors.cvv}
            />
            <span id="cvv-hint" className="hint">
              3 or 4 digits on the back of your card
            </span>
          </div>
        </section>

        {/* ── Submit ── */}
        <button type="submit" className="place-order-btn">
          Place Order — ${total.toFixed(2)}
        </button>
      </form>
    </div>
  );
}
