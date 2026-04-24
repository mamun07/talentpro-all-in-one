export default function Bundle() {
  return (
    <s-page >
        <s-section heading="Create a bundle">
          <s-stack gap="base">
            <s-heading>Product sales</s-heading>
            <s-paragraph color="subdued">No recent sales of this product</s-paragraph>
            <s-button commandFor="modal">Create Bundle</s-button>
          </s-stack>

          <s-modal id="modal" heading="Details">
            <s-paragraph>Displaying more details here.</s-paragraph>

            <s-button slot="secondary-actions" commandFor="modal" command="--hide">
              Close
            </s-button>
            <s-button
              slot="primary-action"
              variant="primary"
              commandFor="modal"
              command="--hide"
            >
              Save
            </s-button>
          </s-modal>
        </s-section>
    </s-page>
  );
}
