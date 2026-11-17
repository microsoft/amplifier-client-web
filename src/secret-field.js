// No hidden field of the app is a sign-in password for the app; the sign-in
// page is public/login.html. With the purpose `off` or `new-password`,
// Chromium offers to save the value of a hidden field as a password after the
// save. With this purpose its form parser does not count the field as a
// password (IsNotPasswordField), so it makes no offer. The field stays
// type="password": the browser hides the value and keeps it out of its form
// history, and the client's private-data rule covers it.
export const secretFieldAutoComplete='one-time-code';
