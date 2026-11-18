package net.okdaily.brain;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Collection;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Compares signing certificates by their SHA-256 digests (the same value apksigner prints as
 * "certificate SHA-256 digest"). Pure Java so it can be tested against real APKs on a computer.
 */
final class SignatureCheck {
    enum Result {
        /** The update is signed by a certificate the installed app is signed with. */
        MATCH,
        /** Both sides were read and no certificate is shared: refuse. */
        MISMATCH,
        /**
         * The phone did not report one side's certificates (some Android builds return no signing
         * info for an APK file). The system installer still refuses a different key, so let it decide.
         */
        UNKNOWN,
    }

    private SignatureCheck() {}

    /** Lower-case hex SHA-256 of a DER-encoded certificate (Signature.toByteArray()). */
    static String certificateDigest(byte[] encodedCertificate) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(encodedCertificate);
            StringBuilder hex = new StringBuilder(digest.length * 2);
            for (byte part : digest) {
                hex.append(String.format(Locale.ROOT, "%02x", part));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 is not available", error);
        }
    }

    static Set<String> digests(Collection<byte[]> encodedCertificates) {
        Set<String> result = new HashSet<>();
        if (encodedCertificates != null) {
            for (byte[] certificate : encodedCertificates) {
                if (certificate != null && certificate.length > 0) {
                    result.add(certificateDigest(certificate));
                }
            }
        }
        return result;
    }

    /**
     * @param installed digests of the certificates the installed app is signed with now
     * @param update digests of the update's certificates (current signer and, with key rotation,
     *     its past signers)
     */
    static Result compare(Set<String> installed, Set<String> update) {
        if (installed == null || update == null || installed.isEmpty() || update.isEmpty()) {
            return Result.UNKNOWN;
        }
        for (String digest : installed) {
            if (update.contains(digest)) {
                return Result.MATCH;
            }
        }
        return Result.MISMATCH;
    }
}
