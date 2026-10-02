import type { NextConfig } from "next";

const GUIDE_PDF_FILENAME = "Como cargo mi numero en la plataforma Wara.pdf";
const GUIDE_PDF_HEADER = `inline; filename="${GUIDE_PDF_FILENAME}"; filename*=UTF-8''Como%20cargo%20mi%20numero%20en%20la%20plataforma%20Wara.pdf`;

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/guides/Como cargo mi numero en la plataforma Wara.pdf",
        headers: [{ key: "Content-Disposition", value: GUIDE_PDF_HEADER }],
      },
      {
        source: "/guides/como-cargo-mi-numero-en-wara.pdf",
        headers: [{ key: "Content-Disposition", value: GUIDE_PDF_HEADER }],
      },
    ];
  },
};

export default nextConfig;
