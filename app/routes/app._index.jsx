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
          edges {
            node {
              key
              value
            }
          }
        }
      }
    }
  `);

  const shopJson = await shopRes.json();
  const shop = shopJson.data.shop;

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
    return json({ error: "Variant ID and threshold are required" }, { status: 400 });
  }

  // 1. Obtener shopId y metacampos existentes
  const shopRes = await admin.graphql(`
    query GetShopWithMetafields {
      shop {
        id
        metafields(first: 10, namespace: "gwp_config_shop") {
          edges {
            node {
              key
              value
            }
          }
        }
      }
    }
  `);

  const shopJson = await shopRes.json();
  const shop = shopJson.data.shop;
  const shopId = shop.id;

  const metafields = Object.fromEntries(
    shop.metafields.edges.map(({ node }) => [node.key, node.value])
  );

  let discountId = metafields.discount_id;

  // 2. Verificar si discountId existe y es válido en Shopify
  let discountExists = false;
  if (discountId) {
    const checkDiscountRes = await admin.graphql(
      `query CheckDiscount($id: ID!) {
        discountNode(id: $id) {
          discount {
            ... on DiscountAutomaticApp {
              id
              discountId
              status
            }
          }
          id
        }
      }`,
      { variables: { id: discountId } }
    );

    const checkJson = await checkDiscountRes.json();
    discountExists = !!(checkJson.data.discountNode && checkJson.data.discountNode.discount);
  }

  // 3. Si no existe o es inválido, crear uno nuevo
  if (!discountExists) {
    const startsAt = new Date().toISOString();
    const FUNCTION_ID = process.env.FUNCTION_ID || "gid://shopify/DiscountFunction/xxxxxxxx";

    const createRes = await admin.graphql(
      `mutation CreateAutoAppDiscount($input: DiscountAutomaticAppInput!) {
        discountAutomaticAppCreate(automaticAppDiscount: $input) {
          automaticAppDiscount { discountId }
          userErrors { field message }
        }
      }`,
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
    const userErrors = createJson.data.discountAutomaticAppCreate.userErrors;

    if (userErrors.length > 0) {
      return json({ error: userErrors }, { status: 400 });
    }

    discountId = createJson.data.discountAutomaticAppCreate.automaticAppDiscount.discountId;
  }

  // 4. Guardar metacampos actualizados
  const metafieldsSetRes = await admin.graphql(
    `mutation SetShopMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { key value }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            namespace: "gwp_config_shop",
            key: "gift_variant_id",
            type: "single_line_text_field",
            value: variantId,
            ownerId: shopId,
          },
          {
            namespace: "gwp_config_shop",
            key: "threshold",
            type: "number_integer",
            value: threshold,
            ownerId: shopId,
          },
          {
            namespace: "gwp_config_shop",
            key: "discount_id",
            type: "single_line_text_field",
            value: discountId,
            ownerId: shopId,
          },
        ],
      },
    }
  );

  const metafieldsSetJson = await metafieldsSetRes.json();
  const metaErrors = metafieldsSetJson.data.metafieldsSet.userErrors;

  if (metaErrors.length > 0) {
    return json({ error: metaErrors }, { status: 400 });
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
