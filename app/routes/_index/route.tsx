import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.page}>
      <main className={styles.content}>
        <div className={styles.logo}>
          <span className={styles.logoMark}>✦</span>
          <span className={styles.logoText}>Insignia</span>
        </div>

        <h1 className={styles.heading}>
          Logo customization for Shopify merchants
        </h1>
        <p className={styles.tagline}>
          Let customers place their logo on your products — handled entirely
          within your store.
        </p>

        <a
          className={styles.ctaButton}
          href="https://apps.shopify.com/insignia"
          target="_blank"
          rel="noopener noreferrer"
        >
          Install on Shopify
        </a>

        <p className={styles.adminNote}>
          Already installed?{" "}
          <span className={styles.adminNoteEmphasis}>
            Access Insignia through your Shopify Admin dashboard.
          </span>
        </p>

        {showForm && (
          <div className={styles.loginSection}>
            <p className={styles.loginLabel}>Or log in with your shop domain:</p>
            <Form className={styles.form} method="post" action="/auth/login">
              <label className={styles.label}>
                <span>Shop domain</span>
                <input
                  className={styles.input}
                  type="text"
                  name="shop"
                  placeholder="my-shop-domain.myshopify.com"
                />
              </label>
              <button className={styles.button} type="submit">
                Log in
              </button>
            </Form>
          </div>
        )}
      </main>

      <footer className={styles.footer}>
        <p>© {new Date().getFullYear()} Insignia · Built for Shopify</p>
      </footer>
    </div>
  );
}
