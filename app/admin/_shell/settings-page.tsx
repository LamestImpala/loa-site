"use client";

import { useState } from "react";
import { useAdmin } from "./admin-provider";
import { buttonClass, inputClass } from "./ui";

export function SettingsPage() {
  const { supabase } = useAdmin();
  const [newPassword, setNewPassword] = useState("");
  const [pwStatus, setPwStatus] = useState("");

  async function savePassword() {
    setPwStatus("");
    if (newPassword.length < 8) {
      setPwStatus("Password must be at least 8 characters.");
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPwStatus(
      error
        ? error.message
        : "Password saved — next time you can sign in with it directly."
    );
    if (!error) setNewPassword("");
  }

  return (
    <>
      <h1 className="mt-6 text-3xl font-semibold">Settings</h1>
      <h2 className="mt-10 text-xl font-medium">Account</h2>
      <p className="mt-1 text-sm text-neutral-400">
        Set a password to sign in directly — magic-link emails are rate-limited
        by Supabase.
      </p>
      <div className="mt-3 flex max-w-md flex-col gap-2 sm:flex-row">
        <input
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="New password (8+ characters)"
          className={`flex-1 ${inputClass}`}
        />
        <button type="button" onClick={savePassword} className={buttonClass}>
          Save password
        </button>
      </div>
      {pwStatus ? (
        <p
          className={`mt-2 text-sm ${
            pwStatus.startsWith("Password saved")
              ? "text-green-400"
              : "text-red-400"
          }`}
        >
          {pwStatus}
        </p>
      ) : null}
    </>
  );
}
