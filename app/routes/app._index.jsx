// app/routes/index.tsx
import { json, redirect } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page, Layout, Text, Card, Button,
  TextField, BlockStack, InlineStack,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useEffect, useState } from "react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const shopRes = await admin.graphql(`
    query {
      shop {
        id
        metafields(first: 10, namespace: "gwp_config_shop") {
          edges { node { key value } }
        }
      }
    }
  `);
  const { data } = await shopRes.json();
  const shop = data.shop;
  const metafields = Object.fromEntries(
    shop.metafields.edges.map(({ node }) => [node.key, node.value])
  );

  return json({ shopId: shop.id, metafields });
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const variantId = formData.get("variantId");
  const threshold = formData.get("threshold");

  if (!variantId || !threshold) {
    return json(
      { error: "Variant ID and threshold are required" },
      { status: 400 }
    );
  }

  // 2) Crear el descuento automático
  const FUNCTION_ID = process.env.FUNCTION_ID;
  const startsAt = new Date().toISOString();
  const createRes = await admin.graphql(
    `#graphql
      mutation CreateAutoAppDiscount($input: DiscountAutomaticAppInput!) {
        discountAutomaticAppCreate(automaticAppDiscount: $input) {
          automaticAppDiscount { discountId }
          userErrors { field message }
        }
      }
    `,
    {
      variables: {
        input: {
          title: "GWP Discount REMIX UI",
          startsAt,
          functionId: FUNCTION_ID,
        },
      },
    }
  );
  const createJson = await createRes.json();
  const createData = createJson.data.discountAutomaticAppCreate;
  if (createData.userErrors.length || !createData.automaticAppDiscount) {
    return json({ error: createData.userErrors }, { status: 400 });
  }
  const discountGID = createData.automaticAppDiscount.discountId;
  if (!discountGID) {
    return json({ error: "No se pudo obtener el ID del descuento." }, { status: 400 });
  }

  // 3) Obtener shopId dentro de la action
  const shopInfoRes = await admin.graphql(`
    query {
      shop { id }
    }
  `);
  const shopInfoJson = await shopInfoRes.json();
  const shopId = shopInfoJson.data.shop.id;  // <-- aquí

  // 4) Crear o actualizar los metafields en el Shop
  const setRes = await admin.graphql(
    `#graphql
      mutation SetShopMetafields($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }
    `,
    {
      variables: {
        metafields: [
          {
            namespace: "gwp_config_shop",
            key:       "gift_variant_id",
            type:      "single_line_text_field",
            value:     variantId,
            ownerId:   shopId,             // <-- usamos shopId aquí :contentReference[oaicite:4]{index=4}
          },
          {
            namespace: "gwp_config_shop",
            key:       "threshold",
            type:      "number_integer",
            value:     threshold,
            ownerId:   shopId,
          },
          {
            namespace: "gwp_config_shop",
            key:       "discount_id",
            type:      "single_line_text_field",
            value:     discountGID,
            ownerId:   shopId,
          },
        ],
      },
    }
  );
  const setJson = await setRes.json();
  if (setJson.data.metafieldsSet.userErrors.length) {
    return json(
      { error: setJson.data.metafieldsSet.userErrors },
      { status: 400 }
    );
  }

  return redirect("/app");
};

export default function Index() {
  const fetcher = useFetcher();
  const { shopId, metafields } = useLoaderData();
  const [variantId, setVariantId] = useState(metafields.gift_variant_id || "");
  const [threshold, setThreshold] = useState(metafields.threshold || "");
  const [discountIdM, setDiscountIdM] = useState(metafields.discount_id || "");

  useEffect(() => {
    setVariantId(metafields.gift_variant_id || "");
    setThreshold(metafields.threshold || "");
    setDiscountIdM(metafields.discount_id || "");
  }, [metafields]);

  return (
    <Page>
      <TitleBar title="Configurar GWP" />
      <Layout>
        <Layout.Section>
          <Card>
            <fetcher.Form method="post">
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Free Gift Settings</Text>
                <Text as="p" variant="bodyMd">{discountIdM}</Text>
                <TextField
                  label="Variant ID"
                  value={variantId}
                  onChange={setVariantId}
                  name="variantId"
                />
                <TextField
                  label="Threshold ($)"
                  value={threshold}
                  onChange={setThreshold}
                  name="threshold"
                  type="number"
                />
                <InlineStack gap="300">
                  <Button submit loading={fetcher.state === "submitting"}>
                    Crear descuento
                  </Button>
                </InlineStack>
              </BlockStack>
            </fetcher.Form>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
