# Refresh `data/hargacloud.json`

Price data for `/kalkulator/`. Run from this folder with a scratch dir `DL`:

```bash
DL=/tmp/harga; mkdir -p $DL/aws
# AWS bulk price list (EC2 files are large: 150-500 MB per region)
for r in ap-southeast-3 ap-southeast-1 ap-northeast-1 us-east-1; do
  for s in AmazonEC2 AmazonRDS AmazonS3 AWSELB AWSDataTransfer AmazonVPC AmazonEKS; do
    curl -sS -o $DL/aws/$s-$r.json https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/$s/current/$r/index.json
  done
  python3 aws_extract.py $DL/aws $r
done
# GCP: Compute/storage/network from the Cloud Billing API export by Cyclenerd,
# Cloud SQL, load balancer and egress tables embedded in the official pricing pages
curl -sSL -o $DL/pricing.yml https://raw.githubusercontent.com/Cyclenerd/google-cloud-pricing-cost-calculator/master/pricing.yml
curl -sSL -o $DL/sql.html https://cloud.google.com/sql/pricing
curl -sSL -o $DL/lb.html https://cloud.google.com/load-balancing/pricing
curl -sSL -o $DL/net.html https://cloud.google.com/vpc/network-pricing
python3 gen_prices.py $DL ../../data/hargacloud.json   # needs PyYAML
```

Then update `asOf` in `gen_prices.py` (it is written into the JSON and shown on the page).
