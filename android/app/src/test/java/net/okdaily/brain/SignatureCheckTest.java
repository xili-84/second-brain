package net.okdaily.brain;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import com.android.apksig.ApkVerifier;
import java.io.File;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.Test;

public class SignatureCheckTest {
    /** The release key's certificate fingerprint (android/README.md). */
    private static final String RELEASE_CERT =
            "e9e4418ce61d3743127e9135ef70ec4ba47a712e8b5f4135861f2b218ee20c2a";

    private static Set<String> set(String... values) {
        return new HashSet<>(Arrays.asList(values));
    }

    @Test
    public void matchesWhenTheCertificateIsShared() {
        assertEquals(SignatureCheck.Result.MATCH, SignatureCheck.compare(set("a"), set("a")));
        // Key rotation: the update lists the old certificate in its history.
        assertEquals(SignatureCheck.Result.MATCH, SignatureCheck.compare(set("old"), set("new", "old")));
    }

    @Test
    public void mismatchOnlyWhenBothSidesAreKnown() {
        assertEquals(SignatureCheck.Result.MISMATCH, SignatureCheck.compare(set("a"), set("b")));
    }

    /** The 1.6.1/1.6.2 bug: the phone returned no signer for the APK file, read as a mismatch. */
    @Test
    public void unreadableSignaturesAreUnknownNotMismatch() {
        assertEquals(SignatureCheck.Result.UNKNOWN, SignatureCheck.compare(set("a"), Collections.emptySet()));
        assertEquals(SignatureCheck.Result.UNKNOWN, SignatureCheck.compare(Collections.emptySet(), set("a")));
        assertEquals(SignatureCheck.Result.UNKNOWN, SignatureCheck.compare(set("a"), SignatureCheck.digests(null)));
    }

    private static File apk(String name) {
        String dir = System.getenv().getOrDefault("SECOND_BRAIN_APK_DIR", "/workspace/brain-release");
        return new File(dir, name);
    }

    private static Set<String> signerDigests(File apk) throws Exception {
        ApkVerifier.Result result = new ApkVerifier.Builder(apk).build().verify();
        assertTrue(apk.getName() + " verifies", result.isVerified());
        List<byte[]> encoded = new ArrayList<>();
        for (X509Certificate certificate : result.getSignerCertificates()) {
            encoded.add(certificate.getEncoded());
        }
        return SignatureCheck.digests(encoded);
    }

    /** Runs where the published APKs are on disk (the build box); skipped elsewhere, e.g. CI. */
    @Test
    public void realReleaseApksMatchEachOtherAndNotADebugBuild() throws Exception {
        File installed = apk("second-brain-1.6.1-release.apk");
        File update = apk("second-brain-1.6.2-release.apk");
        assumeTrue(installed.isFile() && update.isFile());

        Set<String> installedDigests = signerDigests(installed);
        Set<String> updateDigests = signerDigests(update);

        assertEquals(set(RELEASE_CERT), installedDigests);
        assertEquals(set(RELEASE_CERT), updateDigests);
        assertEquals(SignatureCheck.Result.MATCH, SignatureCheck.compare(installedDigests, updateDigests));

        File debug = apk("second-brain-1.1.0-debug.apk");
        if (debug.isFile()) {
            assertEquals(
                    SignatureCheck.Result.MISMATCH,
                    SignatureCheck.compare(installedDigests, signerDigests(debug))
            );
        }
    }
}
