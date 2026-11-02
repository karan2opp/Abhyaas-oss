// Six-character codes students type to join an exam, assignment or series.
// Ambiguous characters (0/O, 1/I) are left out.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const generateJoinCode = (): string => {
    let code = "";
    for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    return code;
};
