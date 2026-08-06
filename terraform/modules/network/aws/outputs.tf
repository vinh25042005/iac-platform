output "vpc_id" {
  value = aws_vpc.this.id
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "nat_gateway_id" {
  value = try(aws_nat_gateway.this[0].id, "")
}

output "sg_allow_internal_id" {
  value = aws_security_group.allow_internal.id
}

output "sg_allow_api_id" {
  value = aws_security_group.allow_api.id
}

output "sg_allow_web_id" {
  value = aws_security_group.allow_web.id
}
